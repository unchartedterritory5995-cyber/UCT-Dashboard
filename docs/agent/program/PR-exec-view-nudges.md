# PR: Step the chart by bars and auto-scale the price axis (C1-032, C1-025)

Branch `agent/pl/scale-step-exec` (pl-exec4), on master `7e9d52d318`. One family, releasable on its own. It does not touch deixis.js, spatialCheck.js, clickRef.js, fastPath.js, the useAgent approval path or Indicator Intelligence, and it does not overlap #1027, #1030, #1059, #1070, #1072, #1073 or the Layout Dock branch.

## What a member can now ask

Two of the chart's own view controls had no Agent path:

| Row | Request | What runs (the member's own writer) | Read back | Undo |
|---|---|---|---|---|
| C1-032 | "go back 5 bars", "step this chart forward one bar" | the Time Navigator's ◀ / ▶ (`StockChart.stepBar(n)`, the same function the buttons call with ±1; n bars in one call, 1 to 100) | the window moved by exactly n bars (`getDateMeta().frame`, right-relative, within a bar) | exact: `restoreView` puts back the window and the view lock it left |
| C1-025 | "auto scale this chart", "fit the price axis again" | the price axis menu's Auto-scale. It is now one writer, `doAutoScale`, in the component body; the menu row calls it through `autoScaleRef`, and so does the Agent through `onDateNavApi.autoScale` | `getDateMeta().priceAuto`: the main price scale's `autoScale` option is on, with no hand-set pin (`priceManualRef`) and no locked vertical placement (`vertMarginsRef`) | none. The hand-set range it drops is not read back, and the receipt says so |

New capabilities: `chartSetup.stepBars` (`direction` back | forward, `bars` 1-100) and `chartSetup.autoScale` (no args). `ChartPane.viewDo` lets `stepBar` and `autoScale` through, next to the four view ops it already allowed.

### The Auto-scale move: is it behaviour-identical?

Yes. The menu's `autoScale` closure (inside the price axis menu builder) moved verbatim to `doAutoScale` in the component body: the same five statements (`vertMarginsRef.current = null`, `priceManualRef.current = false`, `priceManualRangeRef.current = null`, and `applyOptions({ autoScale: true, scaleMargins: _mainMargins(...) })` in the same `try {} catch {}`). The menu row's `onSelect` is now `() => autoScaleRef.current?.()`. `autoScaleRef.current` is re-pointed every render, as `resetViewRef` already is, so it reads the current props. No other line in the menu changed.

## Safety rules

1. A step claims success only when the window moved by exactly the bars asked. A chart that did not move, or moved by a different number of bars, gets no receipt.
2. A window that cannot be read (chart still loading) refuses before the chart is told anything.
3. An unreadable price scale is reported unavailable. It is never reported as "already on auto-scale", and nothing is called.
4. Auto-scale claims success only when the price scale itself reads back as auto.
5. A step's Undo goes stale once the member moves the window (pan, zoom or another step). Undo then refuses and moves nothing.
6. Targeting is the existing chart resolution. With two charts, only the chart named moves (wrong-target control tests for both capabilities).

Neither action is destructive (views only, nothing saved), so there is no confirmation card. This matches setRange and resetView.

Mutants (each turned at least one test red, then was reverted):
- The step read-back accepts any window (`||` in place of the exact-window check): 2 red.
- An unreadable price scale passes the check: 1 red.
- The step's Undo dropped (no `restoreView`): 2 red.
- The Auto-scale read-back always true: 1 red.
- The step's stale-Undo fingerprint dropped: 1 red.
- Failing first: the new test file ran red (14/15) before the capabilities existed.

## Routing

`chartSetup.stepBars` and `chartSetup.autoScale` route in the **boardEdit** group by action name (as `widget.setOption` does), with two word rules ("step / go / move / scroll ... back / forward ... bars", "auto-scale", "fit the price scale / axis"). They are not in the chartSetup group for a measured reason: at 18 actions chartSetup packs after the 17-action lists group and is cut by the 55 budget beside indicators and workspace ("add the Swing Setup indicator template to this chart" lost `indicatorTemplate.apply`). A new group of their own changes every unmatched message's group list, which breaks the frozen no-lookbehind equivalence rail (25 phrases). boardEdit grows from 5 to 7 actions.

## Tests (single files, no lock)

- `app/src/agent/agentChartViewNudges.test.jsx`: 15/15. Covers the step forward and back (one call with ±n), exact Undo of window and lock, stale Undo after a pan, a window that did not move, a window that moved by the wrong number of bars, an unreadable window, 0 and 101 bars, a two-chart wrong-target control; Auto-scale from a hand-set scale (the time window and the board untouched, receipt says no Undo), the no-op, an unreadable scale, a scale that stayed hand-set, a two-chart wrong-target control; and the source checks (the menu and the Agent share `doAutoScale`; `getDateMeta` reports `priceAuto`; the pane allows the two ops; the ◀ button calls `stepBar(-1)`).
- Capability-regression corpus intents `chartSetup.stepBars` (4 phrasings plus Undo, finalState slice 2) and `chartSetup.autoScale` (4 phrasings, slice 3), with routing v1 and v2 and deterministic: 39 passed.
- The whole capability-regression directory (15 files, run once after the corpus insert, at 760b91690d): 3575/3575.
- Related files run together (21 files, at 760b91690d): the new file, agentChartViewControls, agentRouting, agentRoutingS6, agentContracts, agentNl1Selection, agentDiscoveryWordBoundary, the three no-lookbehind rails, agentChartReplay, agentChartsOperatorP1, agentMultiChartMode, nlm1Routing, agentMultiActionFollowups, ChartPane.test, mobileScaleAndVolume, waveOneIntegration, StockChart.timeRangeSync, StockChart.verticalViewLock, noRegexLookbehind: 557/558. The one red was the NL-1 parity fixture: the parity and golden generators raced in one run. It was regenerated on its own in bd77bad9f6, after which agentNl1Selection + agentContracts are 27/27.
- pytest on the 31 server test files that read the golden, parity, corpus, coverage or lock files: 1249 passed, 2 failed. `test_agent_eval_run.py::test_assemble_nl1_is_the_browsers_assembly_exactly` was the same parity race and passes after bd77bad9f6 (11/11). `test_gate_shards.py::test_the_read_set_covers_every_root_relative_path_the_suite_reads` is the known master red (api/ files this PR does not touch).
- eslint on the changed files: no new errors. The pre-existing ones are in lines this PR does not touch (StockChart's 82 empty blocks count the moved `catch {}` once, as master does).

Regenerated: `manifest.golden.json` (UPDATE_AGENT_GOLDEN=1), `tests/fixtures/nl1_assemble_parity.json` (UPDATE_NL1_PARITY=1), capreg `coverage/*` (UPDATE_CAPREG=1), `baseline.lock.json` (`tests/test_uct_agent_capreg_baseline.py --update`, 168 intents).

## Status rows (for the recount at merge; CHARTS_EXECUTION_STATUS.md not edited here)

- C1-025 Auto-scale: MISSING → VERIFIED (simulated). Tests: `agentChartViewNudges.test.jsx` (chartSetup.autoScale) + capreg `chartSetup.autoScale`.
- C1-032 Step one bar back/forward: MISSING → VERIFIED (simulated). Tests: `agentChartViewNudges.test.jsx` (chartSetup.stepBars) + capreg `chartSetup.stepBars`.

The StockChart half (the real time scale and price scale) is jsdom-blind. It is covered by the source checks above and by the requests below.

## Requests to try live (a chart open on /charts)

1. "go back 10 bars": the chart moves 10 bars to the left, the same as ten clicks on ◀. Then "undo": it is back where it was.
2. "step forward one bar": one bar to the right, the same as one click on ▶.
3. Drag the price axis to squeeze the candles, then "auto scale this chart": the candles fill the pane again, and the time window does not move. The receipt says there is no Undo.
4. Right away, "auto scale" again: "already on auto-scale", and nothing happens.
5. With two charts, "move the AMD chart back 3 bars": only the AMD chart moves.

## Known limits

- At most 100 bars per step. A bigger jump is a date (chart.goToDate) or a range (chartSetup.setRange), and the refusal says so.
- Auto-scale has no Undo (the hand-set range is not read back). The member can drag the scale again.
- A live intraday bar that lands during the 10-second read-back wait shifts the right-relative window by one bar. The step is then reported as not confirmed (never a false success), and the member can ask again.
- "Fit" means the price axis menu's Auto-scale (price only). To also reset the time window, the member asks for Reset view (chartSetup.resetView).
- No fast path. These requests go through the model, which passes the direction and count.
- The legacy bar-replay play / step / speed controls (C1-046, UNMAPPED) are not this family. "Step forward" while in Replay Mode moves the view, not the replay cutoff.

## Merge notes

- `agentRouting.test.jsx` FULL.length: 157 → 159 here. #1073 (+1) and #1070 (+4) also bump it; after all three it is 164.
- Golden, parity, capreg coverage and lock conflict with every PR that adds a capability. Resolve by regenerating on the merged tree: `UPDATE_AGENT_GOLDEN=1 UPDATE_NL1_PARITY=1 UPDATE_CAPREG=1` on agentContracts, agentNl1Selection and capreg inventory, then `python tests/test_uct_agent_capreg_baseline.py --update`.
- The capreg corpus inserts two intents after `chartSetup.resetView`, which shifts the finalState slices for later intents (harmless).
- `discovery.js` charts caps line: #1073 edits the same line (adds `chartSetup.compareGroup`). Keep both.

## Files (git diff --stat against the merge base)

```
 app/src/agent/agentChartViewNudges.test.jsx        | 227 +++++++++++++++++++++
 app/src/agent/agentRouting.test.jsx                |   2 +-
 app/src/agent/capabilities/chart.js                |  19 +-
 app/src/agent/capabilities/chartSetup.js           |  48 +++++
 app/src/agent/contract/manifest.golden.json        |  58 ++++++
 app/src/agent/discovery.js                         |   4 +-
 .../baseline/baseline.lock.json                    |  50 +++++
 .../qa/capabilityRegression/baseline/corpus.json   |  89 ++++++++
 .../qa/capabilityRegression/coverage/COVERAGE.md   |  24 ++-
 .../qa/capabilityRegression/coverage/contract.json |  26 +++
 .../qa/capabilityRegression/coverage/coverage.json | 154 ++++++++++++--
 .../qa/capabilityRegression/testing/harness.jsx    |   5 +-
 app/src/agent/routing.js                           |  11 +-
 app/src/components/StockChart.jsx                  |  46 +++--
 app/src/components/chart/pane/ChartPane.jsx        |   4 +-
 tests/fixtures/nl1_assemble_parity.json            |  16 +-
 16 files changed, 715 insertions(+), 68 deletions(-)
(plus this doc, docs/agent/program/PR-exec-view-nudges.md)
```
