# PR — fix "nothing on this workspace" when the page does not offer the kind

Branch `agent/pl/fix-nothing-on-workspace` (from master `70c8c41e9c`). T2 bug fix, no flag.

## Bug

`useAgent.js`, single-kind ops branch of the fast path: whenever the target kind's `list(host)` came back empty, the
Agent replied "There is nothing on this workspace for that to change." On a host that does not PROVIDE that kind's
source, the sentence is false. The workspace is not empty; the capability just isn't offered on this page. It applied
to ANY single-kind request: a layout request on a Charts host built without its layouts source, "open a page" on an
AgentProvider page host built without a navigator, a board/chart/drawing/watchlist kind on any page host.

## Root cause

A target kind's `list(host)` returns `[]` in two different situations: (a) the host has no source for the kind
(`host.layouts`, `host.charts`, `host.widgets`, `host.navigate` … absent), and (b) the source exists and has nothing in
it. The branch could not tell them apart and gave one sentence for both, and that sentence was right for neither.

## Fix

- `capabilities.js`: target kinds may declare `source` (the host key they read, or a predicate), `unavailable`
  (member words for a host without it) and `empty` (member words for an empty list). The new
  `noTargetSentence(kind, host)` returns `{ missing, text }`. When the source is missing it returns the kind's
  `unavailable` words (fallback "That isn't available on this page."). When the list is empty it returns the kind's
  `empty` words (fallback "There is no <noun> here for that to change." / "There is nothing here for that to change.").
  It never says the workspace is empty.
- `useAgent.js`: the single-kind branch uses it. The Multi Chart "board is hidden" refusal still comes first, unchanged.
  The no-source reply is a `refusal` bubble recorded with `reason: 'unavailable-here'`. Both paths return before
  anything runs, and no model call is made.
- Sources declared (generic, one line per kind): layouts→`layouts`; workspace, board→`widgets`; chart, indicators,
  indicatorEdits, definitionLibrary→`charts`; drawing→`drawings`; watchlist, watchlistLibrary→`watchlists`;
  listView→`listViews`; flaggedList→`flagged`; settings, chartTemplates→`prefs`; indicatorTemplates→`prefs.merge`;
  app→`navigate`; breadthPage, screenerPage, journal→their page sources. Empty words: chart, indicators,
  indicatorEdits ("There are no charts on this board yet."), drawing, watchlist, listView, alert, indicatorAlert.

## Host kinds covered

- `/charts` workspace host (ChartsWorkspace shape, `__fixtures__/board.makeBoard`): with layouts (an empty board gives the
  kind-specific empty words) and without a layouts source (layouts are unavailable here).
- AgentProvider page hosts (`hosts/pageHosts.js`): screener, breadth, calendar, journal, each without a navigator.

## Tests

New `app/src/agent/agentNoTargetHere.rail.test.jsx` (9 tests):
- Generic: on every page host, every registered target kind with no target declares a `source` or its own `empty`
  words. A declared source gives "… isn't/aren't available on this page/here", never the old sentence.
- Page hosts: layouts, chart, workspace, drawing and watchlist each name unavailability on this page.
- `/charts` host with sources present: chart/alert/watchlist empty lists give the kind-specific words, not "unavailable".
- Through the panel: `/charts` without layouts + a layout save → unavailable here, no model call, board unchanged.
  `/charts` with an empty board + a timeframe request → "There are no charts on this board yet.". Each of the 4
  page hosts + "open a page" → "Opening other pages isn't available here.". None contains "nothing on this workspace".

Existing pins of the old sentence: **none in tests, capreg corpora or golden baselines** (`git grep` finds only the
historical evidence row in `docs/agent/program/LIVE-TESTING-RESULTS-2026-11-03.md`, which is left as recorded history).
No test was edited or weakened.

## Mutant

`noTargetSentence`'s no-source branch restored to the old sentence → 7 of the 9 new rails fail (all no-source rails).
The 2 empty-list rails stay green, as they should. Restored → 9/9 green.

## Focused runs (local, vitest, no lock)

- Run 1 (22 files, 357 tests, all green): new rail; the 4 count pins (agentRouting, agentScreener, agentNl1Selection,
  agentIndicatorsM2), unchanged; agentNl1SelectionCoverage; agentExecReach (all); agentScanSat1Requests;
  routeReachability; agentNoLookbehindEquivalence (0 frozen rows); noRegexLookbehind; agentNoLookbehind988 (#988);
  agentContracts; agentMultiChartMode (the hidden-board refusal still comes first); agentPage{Journal,Breadth,Screener,Calendar};
  agentLayouts; agentProvider; agentTruthfulness; agentHonestStatus.
- Run 2 (6 files, 1458 tests, all green): capreg corpus.finalState.0–3, corpus.deterministic, golden. No baseline
  regenerated, because none pinned the old wording.
- firstCallRatchet is not on master, so it was not run. ESLint on the changed files: no new findings. The 2 errors in
  `capabilities/chart.js` (lines 967–968, no-useless-escape) were already on master, outside this diff.
