# PR: Custom-Period Sort from the Agent: run a sort, dock the ranking (C3-205, C3-206, C3-207)

Branch `agent/pl/period-sort-exec` (pl-exec6), from master `70dd3a375c`. One family, releasable on its own. It does not touch deixis.js, spatialCheck.js, clickRef.js, fastPath.js, the useAgent approval path or Indicator Intelligence. It stays out of every file #1027 owns for the Period Sort widget (PeriodSortResults.jsx, PeriodSortWidget.jsx, whichWidget.js, widgetControls.js, widget.setOption, board.js, listView.js).

## What a member can now ask

Tools → Custom-Period Sort had no Agent path. By hand: drag a span on a chart, set the popover (Sort, Start, End, Timeframe, Replay mode, Mark start), press Sort; a floating results panel opens; its Dock button turns it into a grid widget.

| Row | Request | What runs (the member's own writer) | Read back | Undo |
|---|---|---|---|---|
| C3-205 | "rank stocks from Oct 1 to today" | `runPeriodSort`, the popover's Sort. It is now one function in ChartsWorkspace; the popover's `onSort` calls it, and so does the Agent host | the floating panel's `{start, end, group}`, the Replay cutoff and the start marker equal what was asked | exact: the panel, cutoff and marker as they were |
| C3-206 | "period sort sectors since Sep 15, replay on, mark the start with a gold line" | the same call, with the popover's Sort (stocks / theme / sector / industry), Replay mode and Mark start (off / line / candle) | as above | as above |
| C3-207 | "dock that ranking" | `handleDockPeriodSort`, the panel's own Dock. It now returns the new widget's id (generated before `setLayout`, the same `w-periodsort-<ms>` id) | the panel is closed and a new `periodsort` widget carries exactly that range and group | exact: the docked widget is removed, any widget the dock's split resized gets its size back (board writer `applyBoard`), and the floating panel returns |

New capabilities: `periodSort.run` (`start`, `end` (null = today), `group`, `replay`, `markStart`) and `periodSort.dock` (no args), on a new target kind `periodSort` (capabilities/periodSort.js). The host gets `periodSort` from ChartsWorkspace (read / run / restore / dock / undock / widgets) through a ref, like `replay`.

### Is the popover change behaviour-identical?

Yes. The `onSort` body moved verbatim into `runPeriodSort` (same five state writes, same order, same comments). The popover still calls `setPeriodSortSel(null)` first, then `runPeriodSort(start, end, replay, group, tf, markStart)`. `applyTfToCharts(null)` returns at once, and the popover always passes a timeframe, so the manual path is unchanged. `handleDockPeriodSort` builds the same id at the same moment and adds `return id`.

## Safety rules (one mutant each, all killed; evidence/period-sort/mutants.txt)

1. A run claims success only when the panel, cutoff and marker read back exactly as asked. A run that never lands gets no receipt. Mutant m1 (read-back always true): 1 red.
2. A state that cannot be read refuses with "I can't read the Custom-Period Sort right now". It is never treated as "no panel open". Mutant m2 (unreadable read as empty): 1 red.
3. Dock refuses when no panel is open, and nothing on the board changes. Mutant m3 (check removed): 1 red.
4. Dock's Undo is exact: a widget the split resized gets its size back. Mutant m4 (geometry dropped): 1 red.
5. A run's Undo goes stale once the member runs another sort themselves; Undo then refuses and closes nothing. Mutant m5 (fingerprint dropped): 1 red.
6. Wrong-target control: a Period Sort widget already on the board is never touched by run, dock or Undo; Undo removes exactly the docked widget. Mutant m6 (Undo removes the first Period Sort widget): 1 red.

Neither action is destructive (a view, and an add with exact Undo), so there is no confirmation card. No existing Period Sort widget is ever targeted (that is #1027's widget.setOption and its which-widget rules).

Failing first: `agentPeriodSort.test.jsx` ran 12 failed / 7 passed with the capabilities unregistered (evidence/period-sort/red-run.txt). The 7 that passed were the routing and source checks, written with the code.

## Routing and budget

`periodSort.*` route by DOMAIN in the **boardEdit** group (5 → 7 actions), with three word rules: the tool's name ("period sort", "custom period"), a rank / sort said over dates (a month-day, M/D or ISO day after from / since / between), and "dock … ranking / sort". No bare common words.

- Not a new group: that changes every unmatched message's group list (the frozen no-lookbehind rows). `agentNoLookbehindEquivalence` passes with zero frozen rows changed.
- Not the screener group: screener is in the NL-1 core, sent on every request.
- The word "custom" is kept out of the indexed text (boardEdit title, summaries). With "Custom-Period Sort" in the title, routing v2's lexical index pulled "create a custom copy of the rsi indicator" away from definitions, and `definition.duplicate` became unreachable (measured by the rail; fixed before commit).
- Pack size: NL-1 core 42 + boardEdit 7 = 49, under the 55 budget.
- v2 budget-cut rate (routeReachability rail): master 97/1081 (9.0%). After, on the corpus with the 8 new phrasings: 100/1090 (9.2%). On that same 1090-phrasing set, master's routing gives 101/1090, so the change itself does not raise the rate. No action is newly unreachable under v1 or v2. boardEdit is cut on 8 phrasings (master 4); every one still reaches its own action, per the rail.

## Count pins

- `agentRouting.test.jsx` FULL.length: 157 → 159 (+ periodSort.run, periodSort.dock).
- `agentScreener.test.jsx` manifestFor(CTX).length: 151 → 153.
- `agentNl1Selection.test.js` core: unchanged (boardEdit is not a core group).
- `agentIndicatorsM2.test.jsx` indicators group: unchanged.

## Tests

- `app/src/agent/agentPeriodSort.test.jsx`: 19/19. Run (range, grouping, replay, marker, end = today, exact Undo, replay turned off and said, refusals, a run that never lands, stale Undo), dock (exact Undo, split geometry, no panel, wrong-target control, contract), routing words, source checks (one writer), and the REAL panel (scripted model).
- Capability-regression corpus intents `periodSort.run` (4 phrasings + Undo) and `periodSort.dock` (4 phrasings + Undo, after a run), TIMED board; the harness gets a Custom-Period Sort host that shares the one Replay cutoff, and run.jsx checks `periodSortPanel` / `periodSortWidgets`.
- Focused set, 30 files (the 4 pin files, routeReachability, the no-lookbehind rails, agentContracts, agentNl1Selection(+Coverage), agentChartReplay, nlm1, …): 654/654 (evidence/period-sort/focused-1.txt).
- Whole capability-regression directory + ChartsWorkspace / PeriodSort / floating panel tests: 27 files, 3764/3764 (evidence/period-sort/capreg-dir-and-workspace.txt).
- pytest on the server tests that read the golden, parity, corpus, coverage or lock files: 1024 passed, 1 failed: `test_gate_shards.py::test_the_read_set_covers_every_root_relative_path_the_suite_reads`, the known master red (evidence/period-sort/pytest.txt).
- eslint: the new and changed agent files are clean. ChartsWorkspace.jsx has the same 12 problems as master (9 errors, 3 warnings), none in changed lines.

Regenerated: `manifest.golden.json` (UPDATE_AGENT_GOLDEN=1), `tests/fixtures/nl1_assemble_parity.json` (UPDATE_NL1_PARITY=1, run on its own), capreg `coverage/*` (UPDATE_CAPREG=1), `baseline.lock.json` (`tests/test_uct_agent_capreg_baseline.py --update`, 168 intents).

Server: `api/services/uct_agent/turn_v2.py` maps the `periodSort` prefix to the `board` domain tool. Without it, the dark v2 tools path files unlisted prefixes under `history`. `tests/test_uct_agent_contract.py` mirrors the group (`periodSort` → `boardEdit`).

## Status rows (for the recount at merge; CHARTS_EXECUTION_STATUS.md not edited here)

- C3-205 Start a custom-period sort: MISSING → VERIFIED (simulated). Tests: agentPeriodSort.test.jsx + capreg `periodSort.run`.
- C3-206 Choose grouping, replay and start mark: MISSING → PARTIAL. Grouping, Replay mode and Mark start are covered; the popover's Timeframe is not (see limits).
- C3-207 Dock the panel or add it as a tab: MISSING → PARTIAL. Dock is covered; "add as a tab" is not.

These are simulated tests: jsdom, a scripted model, and a fake Custom-Period Sort host that applies the workspace's rules. The real ChartsWorkspace is not mounted. The source checks pin the wiring: the popover and the Agent call the same `runPeriodSort`, the Agent passes no timeframe, and Dock is `handleDockPeriodSort` returning its id.

## Requests to try live (on /charts, admin)

1. "rank stocks from Oct 1 to today": the floating Custom-Period Sort panel opens on that range (US common stocks). Then "undo": it closes.
2. "period sort sectors from Sep 15 to Oct 15, replay on, mark the start with a gold line": the panel shows Sectors, every chart hides the bars after Oct 15, and a gold line marks Sep 15. "undo" puts the replay and marker back as they were.
3. With the panel open, "dock that ranking": a Period Sort widget appears on the board with the same range, and the panel closes. "undo": the widget goes, any widget it squeezed gets its size back, and the panel returns.
4. Turn Replay Mode on first ("replay from Oct 15"), then "rank themes from Oct 1 to Oct 30": the receipt says Replay Mode is now off. The popover's Sort does the same.
5. With no panel open, "dock the period sort": a refusal, and nothing changes.

## Known limits

- The popover's Timeframe is not offered. The Agent never switches the charts' timeframe for a sort; ask for it separately (chart.setTimeframe).
- "Add as a tab of another widget" is not offered. It would target an existing widget, which needs #1027's which-widget rules.
- The drag-to-highlight entry is a pointer step. Dates come from words: YYYY-MM-DD, "Oct 1", "today", "last Friday".
- The floating panel is a view, as by hand: a reload drops it. Dock keeps it.
- The sort's own Refresh, and settings on a docked widget, belong to #1027 (C3-208, widget.setOption).
- The `periodSort` kind is board-scoped, like chart.replay. A run's receipt also waits on the board save acknowledgment, and Undo does not cross a layout switch.
- No fast path. Requests go through the model, which passes the dates.

## Merge notes

- #1027 (widget actions): no shared source file except the generated ones. It conflicts on `manifest.golden.json`, capreg `corpus.json` / `baseline.lock.json` / `coverage/*`, `testing/harness.jsx`, `routing.js`, `host.js` and the agentRouting / agentScreener pins. Keep both sides, then regenerate.
- #1077 (step bars + auto-scale): both PRs edit the boardEdit group line in `routing.js`. #1077 adds `actions: chartSetup.stepBars / autoScale` and two word rules; this PR adds the `periodSort` domain, title words and three word rules. Keep both. boardEdit then holds 9 actions: core 42 + 9 = 51, under 55. Re-run `routeReachability.test.js` and `agentNoLookbehindEquivalence.test.js` on the merged tree.
- FULL.length after #1077 (+2) and this PR (+2) is 161 (plus #1073 +1 and #1070 +4 if they land first). The Screener CTX pin moves the same way.
- Regenerate on the merged tree: `UPDATE_AGENT_GOLDEN=1` (agentContracts), then `UPDATE_NL1_PARITY=1` (agentNl1Selection) on its own, then `UPDATE_CAPREG=1` (capreg inventory), then `python tests/test_uct_agent_capreg_baseline.py --update`.
- The corpus inserts two intents after `chart.replay`, which shifts the finalState slices for later intents (harmless).
- `turn_v2.py` adds one line to `_DOMAIN_OF`, on the dark v2 tools path only.

## Files (git diff --stat against the merge base)

```
 api/services/uct_agent/turn_v2.py                                    |    1 +
 app/src/agent/agentPeriodSort.test.jsx                               |  243 +++++
 app/src/agent/agentRouting.test.jsx                                  |    2 +-
 app/src/agent/agentScreener.test.jsx                                 |    2 +-
 app/src/agent/builtins.js                                            |    3 +
 app/src/agent/capabilities/periodSort.js                             |  242 +++++
 app/src/agent/contract/manifest.golden.json                          |  123 +++
 app/src/agent/host.js                                                |    5 +-
 app/src/agent/qa/capabilityRegression/baseline/baseline.lock.json    |   50 +
 app/src/agent/qa/capabilityRegression/baseline/corpus.json           |  128 +++
 app/src/agent/qa/capabilityRegression/coverage/COVERAGE.md           |   24 +-
 app/src/agent/qa/capabilityRegression/coverage/contract.json         |   26 +
 app/src/agent/qa/capabilityRegression/coverage/coverage.json         |  160 ++-
 app/src/agent/qa/capabilityRegression/testing/harness.jsx            |   29 +
 app/src/agent/qa/capabilityRegression/testing/run.jsx                |    3 +
 app/src/agent/routing.js                                             |   10 +-
 app/src/pages/charts/ChartsWorkspace.jsx                             |   67 +-
 docs/agent/program/PR-exec-period-sort.md                            |  103 ++
 docs/agent/program/evidence/period-sort/capreg-dir-and-workspace.txt | 1740 ++++++++++++++++++++++++++++++++
 docs/agent/program/evidence/period-sort/focused-1.txt                |  806 +++++++++++++++
 docs/agent/program/evidence/period-sort/mutants.txt                  |   30 +
 docs/agent/program/evidence/period-sort/pytest.txt                   |    3 +
 docs/agent/program/evidence/period-sort/red-run.txt                  |  222 ++++
 tests/fixtures/nl1_assemble_parity.json                              |   20 +-
 tests/test_uct_agent_contract.py                                     |    4 +-
 25 files changed, 3986 insertions(+), 60 deletions(-)
```
