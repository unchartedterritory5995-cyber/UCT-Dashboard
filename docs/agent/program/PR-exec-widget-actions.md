# PR: one widget-action layer for the /charts data widgets, and watchlist groups A–D

Branch `agent/pl/exec-widget-actions` (pl-widget), on master `b2300e547d`. It carries pl-exec's watchlist groups A and D
(cherry-picked from `agent/pl/exec-watchlist` `dba7a2d269`; no conflicts) and adds the rest. Shared files (manifest golden,
capreg contract / coverage / lock, the status doc) are in the last commit only.

## The layer

Every member action on a data widget is one data row, not a code path:

- `app/src/widgets/widgetControls.js` (OWN, metadata only) and `app/src/agent/widgetNames.js` (AGENT_CONTROLS, rows with a
  `when` / `write`).
- The rows are run by `widget.setOption` (`app/src/agent/capabilities/board.js`) through the widget's own door
  (`app/src/pages/charts/widgetDoors.js`: `{ read, options, write, act, capture, about }`).

This PR adds two row types, one door verb and one capability:

| Piece | What it is | Rows |
|---|---|---|
| `action` row type | One of the widget's own buttons. It runs through the door's `act(key)`. The receipt is shown only once that call resolves; a failed run fails the change in words. There is no Undo, because nothing is kept. | Scanner Refresh (C3-112), Period Sort Refresh (C3-208) |
| `color` row type | A colour as the widget's own swatch stores it, `#rrggbb` (`#rgb` is spelled out). A colour name is the planner's job to convert. | Watchlist canvas / text / gain / loss colours (C3-103) |
| Named item create | `create:<name>` on an ITEM_LISTS list marked `named`. It is shown first, because it replaces a same-name item. | Save a Watchlist look (C3-104) |
| `watchlist.arrangeColumns` (new capability) | It moves a column the way the header drop does, and sets a width the way the gridline does. Both use the widget's own results, `movedColCfg` / `resizedColCfg`, which are now extracted in `Watchlists.jsx`. The drag and the Agent share them. Width range: the column's own minimum to 600 px. | C3-085, C3-086 |

New door rows that use existing types:

- Scanner back to its picker (C3-108): an opts row, as its own "change scan" writes it.
- Watchlist logos and tint (C3-103).
- Watchlist apply-a-look (C3-104).
- Rename Flagged (C3-074): the title menu's `renameFlagged`. It is offered only while the widget shows Flagged.

Product files touched (all additive):

- `ScannerResults.jsx`: door `act`.
- `PeriodSortWidget.jsx` / `PeriodSortResults.jsx`: a `refreshRef`. The footer button and the door call the same `refresh`.
- `Watchlists.jsx`: door `read` / `options` / `write`, and the extracted column results.
- `host.js`: the listView snapshot carries `cols`.
- `discovery.js`: lists `watchlist.arrangeColumns`.

**Not touched:** `routing.js`, `useAgent.js`. The new capability routes by its `watchlist` domain.

## Tests (LOCAL, SIMULATED: vitest + jsdom, scripted model, fixture data; not a real browser, not the real model)

Held-out phrasings were written as families and committed BEFORE each change:

- `agentWidgetActionsHeldOut.test.js`
- `agentWatchlistLookHeldOut.test.js`
- `agentWatchlistColumnsHeldOut.test.js`

Outcome tests run the REAL Agent panel beside the REAL widgets. They read the widget's opts, its door, its data hook, or the
stored preference, never a receipt alone. Each one checks the other widget is untouched and that Undo is exact:

- `qa/chartsOutcome/widgetJournal.outcome.test.jsx`: Alerts, News, Market Context, AI Search, Fundamentals → Journal.
- `qa/chartsOutcome/widgetActions.outcome.test.jsx`: Scanner / Period Sort Refresh; Scanner back to its picker.
- `qa/chartsOutcome/watchlistLook.outcome.test.jsx`: the real WatchlistWidget, for appearance, looks and Flagged rename.
- `qa/chartsOutcome/listControl.outcome.test.jsx`: block 3, column move and width on the real widget.

**Before the fix:** product files were reverted to the cherry-picked base `59c6383b0a` and the tests were kept.

- Command (from `app/`): `npx vitest run src/agent/qa/chartsOutcome/widgetActions.outcome.test.jsx src/agent/qa/chartsOutcome/watchlistLook.outcome.test.jsx src/agent/qa/chartsOutcome/listControl.outcome.test.jsx -t held-out`
- Totals: `Tests 48 failed | 3 passed | 104 skipped (155)`. The 3 that passed are the frozen-data checks. Every held-out case failed.

**Mutation checks.** Three mutations on head `ed18c50092`, run in a scratch worktree over the same three files:

- `runActs` no longer awaits the button.
- A `color` accepts any word.
- `arrangeColumns` takes the wrong drop target for "before".

Totals: `Tests 5 failed | 150 passed (155)`. Each mutation was caught by its own test: the failed re-read test, the "bluish" refusal, and two move cases. The fifth failure was the known gap below, which was not yet pinned in that tree.

**After:** see "Results" below.

## Rows moved (recounted by `docs/agent/program/recount-widget-actions.mjs`)

- **VERIFIED (17):** C3-063, C3-064, C3-065, C3-067, C3-074, C3-085, C3-086, C3-094, C3-095, C3-104, C3-108, C3-112, C3-132, C3-137, C3-186, C3-200, C3-208.
- **PARTIAL (2):**
  - C3-103: logos, tint, solid canvas, text, gain and loss colours are covered. Gradient, fonts, grid colour and tint colours are not.
  - C3-180: the Journal half only. Fundamentals appearance is a global preference with no door row.
- **Counts:** VERIFIED 225 → 242 of 484 (50.0%). PARTIAL 9 → 11. IMPL 69 → 68. MISSING 126 → 108.

Notes:

- C3-200's conversation is seeded through the widget's own `initialThread` prop. That is fixture data; no paid stream ran.
- C3-094 / C3-095 are proven in two layers. The panel test uses a stand-in door. `Watchlists.listout.test.jsx` proves that the
  real door reaches exactly the list menu's Copy / Export handlers.
- Conflict note: pl-auto's #1023 also edits `CHARTS_EXECUTION_STATUS.md`. Whichever lands second re-runs its recount script on
  the new master. Both scripts first check that they reproduce the current table, so a stale run stops instead of writing.

## Known gaps and not done

- **KNOWN GAP (C3-086 phrasing):** "narrow the price column to 50" is answered BEFORE the model by the quote fast path ("I'm
  not sure which instrument 'narrow' means"). It is pinned both ways: an `it.fails` outcome, plus today's exact answer. The fix
  belongs in `useAgent`, which is Lead-owned.
- **C3-166 sweeps:** owner-gated (F-16). The Lead ruled that only "Calls Only" is approved (#872), so `FLOW_WIDGET_REFUSAL`
  is kept. Not edited.
- **Deferred:**
  - C3-071 (create a list from a template): no such control on /charts was found.
  - C3-072 (save a community list): `SaveListDialog` makes the member pick copy or link and does the POST itself. That needs
    the save extracted from the dialog, or a member choice.
  - C3-097 (version history): behind `ARTIFACT_VERSIONS_ENABLED`; restore lives in `ArtifactHistory`.
  - C3-084 / C3-089: unchanged (C3-084 is NOT ON /CHARTS; C3-089's collapse is scan grouping, not a list).
  - Volume Surge thresholds (C3-124): still read with no product range (settingsLiveness pins them refused).
- **Owner-blocked, untouched:** C3-091, 092, 093, 105, 106.
- **Two widgets:** a request with no referent is the planner's to clarify. The tests prove that the request tells two Scanner
  widgets apart by position, and that the named one is the only one refreshed. Watchlist rows ask, as group A/D already do.

## Results (LOCAL, SIMULATED)

- **Command (from `app/`, under the suite lock, BelowNormal):** `npx vitest run` over 26 named files: the 4 new and extended outcome files, the 3 held-out files, the 4 neighbouring chartsOutcome files (widgetDoorRows, widgetControls, themeTracker, teNewsWatchlist), settingsLiveness, agentWidgetOptions, agentExecSideEffect, watchlist group A/D (Show, Out, their held-out files, Watchlists.listout), and the golden readers (agentContracts, capreg inventory, agentSurfaces, agentNl1Selection, agentCoachRoutingParity, agentEvalBaseline, agentNl1Eval).
- **Commit:** `8112d814f3`, plus the parity-fixture regen in the next commit.
- **Scope:** 26 files, focused. This is NOT a full run; the Lead schedules that.
- **Totals:** `Test Files 1 failed | 25 passed (26)` / `Tests 1 failed | 1100 passed (1101)`. The one failure was `agentNl1Selection` "matches the committed parity fixture": the committed `tests/fixtures/nl1_assemble_parity.json` still had the watchlist routing title from before group D. I regenerated it with its own switch (`UPDATE_NL1_PARITY=1`), then re-ran `agentNl1Selection.test.js` without the switch: `Tests 13 passed (13)`.
- **Not run (forbidden here):** pytest. `tests/test_agent_eval_run.py` reads the regenerated parity fixture, and `tests/test_uct_agent_capreg_baseline.py` reads the lock, which was rewritten by its own `--update` script entry (not pytest). Both are for the Lead's CI.
- **Notebook first-open bytes:** `tools/notebook_perf_budgets.py --dist` on `vite build` output. This head: 2,256,278 B. Master `b2300e547d`: 2,256,278 B. Both builds were made with the same tool on the same machine. **Delta 0 B.** Budget 2,260,793 B, PASS.
