# PR: Custom-Period Sort from the Agent: run a sort, dock the ranking (C3-205, C3-206, C3-207)

Branch `agent/pl/period-sort-exec` (pl-exec6), from master `70dd3a375c`. One family, releasable on its own. It does not touch deixis.js, spatialCheck.js, clickRef.js, fastPath.js, the useAgent approval path or Indicator Intelligence. It stays out of every file #1027 owns for the Period Sort widget (PeriodSortResults.jsx, PeriodSortWidget.jsx, whichWidget.js, widgetControls.js, widget.setOption, board.js, listView.js).

## Re-merged onto 1208aa0085 (2026-11-11)

Head after the re-merge: `3e4779be9d` (merge `362bc237af` + SAT-1 regeneration), then this doc commit. Master since the first build: #1077, #1027, #1084, #1073, #988 and other teams' changes (#1088 StockChart).

**Routing changed shape: periodSort is now its OWN words-only group**, not part of boardEdit. Merging #1077's boardEdit (5 actions, its own words) with this PR's boardEdit additions (domain `periodSort`, title, 3 word rules) was measured first: routing v2 first calls lost the needed action on 5 rows (in→out 5; v1 0), because the bigger boardEdit title and size moved v2's lexical scores and its fill. So, as #1027 / #1073 did:

- `boardEdit` is character-identical to master.
- New group `periodSort` (actions `periodSort.run`, `periodSort.dock`; `domains: []`, `fillLast`, `wordsOnly`), with this PR's three word rules unchanged: the tool's name; rank / sort … from / since / between … a date; dock … ranking / sort. The title avoids the word "custom" (see "Routing and budget" below).
- It is LAST in GROUPS. turn.py names at most `MAX_GROUPS = 24` groups and master already sends 24, so this group (not one of master's) is the one the server leaves unnamed until #1089 raises the cap. **Known red until #1089:** `tests/test_uct_agent_nl1_selection.py::test_a_routed_nl1_request_is_three_cache_blocks_core_first` (extra item: `periodSort` only). turn.py is not touched here.
- One routing-logic line in `namedGroups`: a docked Period Sort widget named beside a date (the tool's name + a month-day / ISO / M/D) does not bring boardEdit on its own. Without it, agentExecSideEffect (pinned at 0) found 3 of this PR's own corpus phrasings newly adding boardEdit (+5,258 bytes each) when a Period Sort widget is on the board. That widget's only control is Refresh, which takes no date; "refresh the period sort" still routes boardEdit (pinned). Mutant (exception off): 2 red in agentPeriodSort.test.jsx.
- nlm1Routing OWN_WORDS: `periodSort` gets 4 phrases of its own words, plus 6 negative controls (a bare sort / rank / dock / period never selects it).
- `tests/test_uct_agent_contract.py`: `periodSort` → `periodSort` (was `boardEdit`).

**First calls vs master over the standard 3650 requests** ([evidence/period-sort/remerge-first-calls-1208aa0085.md](evidence/period-sort/remerge-first-calls-1208aa0085.md)): v1 in→out **0**, v2 in→out **0**. Only 2 rows change groups (both C3-206 rows, + periodSort; out→out on their old widget.setOption expectation). In with an expectation: v1 643 = 643, v2 676 = 676.

**Pins** (master's actual + this PR):

- `agentRouting.test.jsx` FULL.length: master 164 + periodSort.run + periodSort.dock = **166**.
- `agentScreener.test.jsx` manifestFor(CTX).length: master 158 + 2 = **160**.
- `agentNl1Selection.test.js` core and `agentIndicatorsM2.test.jsx` indicators group: unchanged (master's).

**Generated files** were reset to master and regenerated, each in its own run: `manifest.golden.json` (UPDATE_AGENT_GOLDEN=1, +123 lines as before), `nl1_assemble_parity.json` (UPDATE_NL1_PARITY=1: the 2 actions' group map + the periodSort group in the catalog), capreg `coverage/*` (UPDATE_CAPREG=1), `baseline.lock.json` (`--update`: 173 intents, 42 refusals, 31 workflows; `periodSort.run` and `periodSort.dock` intents present in corpus.json). SAT-1 `section_b_requests.json`: regenerated in its own commit (`3e4779be9d`). All 120 added lines are the periodSort `{id, title}` in the named-group catalog of 30 requests. No line was removed, and no request's selected groups changed.

PeriodSortResults.jsx / PeriodSortWidget.jsx: this PR does not edit them, and the merge left #1027's versions as they are. `CHARTS_EXECUTION_STATUS.md` is master's: this PR has no rows in it (see "Status rows" for the recount).

**Tests on the final tree** (summary: [evidence/period-sort/remerge-tests.txt](evidence/period-sort/remerge-tests.txt)):

- Focused run A, 25 files (4 count pins, agentNl1SelectionCoverage, agentExecReach, agentScanSat1Requests, routeReachability, agentNoLookbehindEquivalence, noRegexLookbehind, capreg routing / routingV2 / inventory / collision ×2, agentContracts, nlm1Routing, agentPeriodSort, agentExecSideEffect, the widget-action rails): 2514/2514.
- agentNoLookbehindEquivalence: 0 frozen rows changed. ExecReach: v2 list held-out 8/8, and every other reach line is equal to master's.
- Run B (capreg finalState 0–3 / deterministic / dark / golden, the PeriodSort config and agent tests, the widget-settings and watchlist column tests): see the summary file.
- pytest, full `tests/test_uct_agent*.py` (this PR touches turn_v2.py): 4126 passed, 1 failed, which is the MAX_GROUPS test above. The golden / parity / section_b readers outside that glob (test_agent_eval_proxy, test_agent_eval_run, test_desk_session_recap): 29/29.

### Move read: `runPeriodSort` (ChartsWorkspace.jsx)

Master `1208aa0085`, the popover's inline `onSort` (lines 4182–4195):

```
onSort={(start, end, replay, group, tf, markStart) => {
  setPeriodSortSel(null)
  setPeriodSortPanel({ start, end, group: group || null })
  const s = String(end)
  setReplayCutoff(replay ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null)
  const st = String(start)
  setStartMarker(markStart && markStart !== 'off' ? `${st.slice(0, 4)}-${st.slice(4, 6)}-${st.slice(6, 8)}` : null)
  if (markStart === 'line' || markStart === 'candle') setStartMarkerStyle(markStart)
  applyTfToCharts(tf)
}}
```

This branch: the popover keeps line 1 and calls the extracted function with the same six arguments in the same order:

```
onSort={(start, end, replay, group, tf, markStart) => {
  setPeriodSortSel(null)
  runPeriodSort(start, end, replay, group, tf, markStart)
}}

const runPeriodSort = useCallback((start, end, replay, group, tf, markStart) => {
  setPeriodSortPanel({ start, end, group: group || null })                                    // = inline line 2
  const s = String(end)                                                                         // = line 3
  setReplayCutoff(replay ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null)          // = line 4
  const st = String(start)                                                                      // = line 5
  setStartMarker(markStart && markStart !== 'off' ? `${st.slice(0, 4)}-${st.slice(4, 6)}-${st.slice(6, 8)}` : null) // = line 6
  if (markStart === 'line' || markStart === 'candle') setStartMarkerStyle(markStart)            // = line 7
  applyTfToCharts(tf)                                                                           // = line 8
}, [applyTfToCharts])
```

Why it behaves the same:

1. Same statements, same order, same expressions. The comments are copied too. `setPeriodSortSel(null)` still runs first, in the popover.
2. Every setter is a React `useState` setter, so its identity is stable. The only captured value that is not a setter is `applyTfToCharts`. It is a `useCallback` declared earlier (line 1632, so there is no TDZ) and listed in the deps, so `runPeriodSort` always calls the current one, as the inline closure did on each render.
3. All the writes happen in one event handler, so React batches them exactly as before. There is no new await or effect.
4. `handleDockPeriodSort`: the id expression `` `w-periodsort-${Date.now()}` `` moved out of the `setLayout` updater to just before it, and the function now `return id`. The updater always appends the widget (there is no early return), so the returned id is the widget's id. The one difference is that `Date.now()` is read a few microseconds earlier, and under StrictMode's double-invoked updater both invocations now use the same id.

#### Named difference in the move: dock id computed before setLayout

What moved, in `handleDockPeriodSort` (ChartsWorkspace.jsx):

```
// master 1208aa0085 — inside the setLayout updater
setLayout(prev => {
  …
  const newWidget = {
    id: `w-periodsort-${Date.now()}`,
    type: 'periodsort', color,
    …

// this branch — one line before setLayout; the updater uses it
const id = `w-periodsort-${Date.now()}`
setLayout(prev => {
  …
  const newWidget = {
    id,
    type: 'periodsort', color,
    …
})
return id
```

A correction to the framing first: the id does not come from layout state in either version. It comes from the clock, `Date.now()`, and the expression is the same in both. Everything else about the widget comes from `prev` inside the updater, and none of it moved: placement (`findPlacement` / `splitToSide` / `splitToFit`), `color` (`pickWidgetColor`), `w` / `h` and `opts: { start, end, group }`. So the docked widget lands identically: same cell, same size, same split of a neighbour, same colour and same opts. `scheduleSave(next)` saves the same layout.

It is not byte-identical in one respect, the id's millisecond value:

- In master, `Date.now()` is read when React runs the updater. React may run it eagerly during the `setLayout` call, or later during render, so it can read a later millisecond than this branch, which reads it just before the call.
- Under React StrictMode (dev only), the updater runs twice. Master could mint two different ids across the two runs (React keeps one). This branch uses the one id for both.

Nothing reads the number. No code parses or sorts `w-periodsort-*` ids (the only other occurrence is the test harness's own counter). Two docks within the same millisecond would collide in either version, the same as before. The visible behaviour is the same; only the timestamp inside the id may differ by the gap between the call and the updater.

The ChartsWorkspace diff against master is exactly the first build's 6 hunks (dock id, runPeriodSort, the Agent ref, the host `periodSort` object, the popover call). Master's changes since then did not touch these lines. The source rail in agentPeriodSort.test.jsx pins the popover → runPeriodSort call and the Agent's call without a timeframe.

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

(First build. Superseded by "Re-merged onto 1208aa0085" above: periodSort is now its own words-only group and boardEdit is master's.)

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
