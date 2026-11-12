# PR: chart right-click parity: Ask AI, watermark Reset, Send to Journal proven (C1-178, C1-061, C1-176)

Branch `agent/pl/chart-rclick-parity`, from master `7a2c1fae47`. One family (C in the 11-11 missing-families audit), releasable on its own. Evidence class: LOCAL / SIMULATED (jsdom, the real ChartWidget and the real Agent panel, the model scripted, no paid call, no backend). It does not touch deixis.js, spatialCheck.js, clickRef.js, fastPath.js, the useAgent approval path or Indicator Intelligence.

## What a member can now ask

| Row | Request (examples) | What runs | Undo |
|---|---|---|---|
| C1-176 | "send this chart to my journal" | already shipped: `widget.sendToJournal` over ChartWidget's own capture door. **Now proven**: it sends the same capture, to the same default place (note), as the right-click "Send to Journal". | none (as at the door) |
| C1-178 | "ask AI about this chart", "open the AI on the NVDA chart" | new `chartMenu.askAi`: `host.charts.askAi` → the ChartWidget adapter → `openAskAi`, the one opener the right-click "Ask AI about {sym}" now also calls (`/research/:sym?section=ai`). It leaves Charts, so, like `app.open`, it opens 900 ms after the receipt (and from a hidden tab only once the member is back). | none: the receipt says "use Back" |
| C1-061 | "reset the watermark", "put the watermark back where it was" | new `chartMenu.resetWatermark`: `opts.watermarkPos = null` through the chart kind's existing watermarkPos patch, the same write as Chart Settings → Watermark → "Reset to center" (ChartWidget `resetWatermark`). Read back from the widget's opts. A watermark never moved is a no-op. | exact (the position before, anchor included) |

Product change: ChartWidget's `handleAiSearch` body moved into `openAskAi` (same `navigate` call; `handleAiSearch` = `closeCtx(); openAskAi()`). The menu item's behaviour is unchanged; `ChartWidget.rclickParity.test.jsx` clicks the real menu item and checks the location.

## Not done (stopped, with reasons)

- **C1-100 / C2-041 "show the latest value in the header"**: STOP on ownership. The writer is the Indicators chip menu (`StockChart.handleChipInfoValue` → `engine/infoValues.addInfoValue`), and the Indicators agent contract (`components/chart/builder/agentMutations.js`) has no info-value op (it only reports info values that a removal severs). Writing `header.infoValues` from the chart kind would be a second writer beside Indicators' mutation path (the same class of stop as #1059 on C1-092). Needs an Indicators-owned op first. Status rows say so.
- C1-177 "choose where": PARTIAL. The destination (note / newNote / inbox) already works through `widget.sendToJournal`. The picker's comment and "Copy chart link" are not covered.
- C1-179 (add widget floating at the click), C1-003, C1-055: not in this slice. Theme all widgets (C1-081): skipped as asked (T2, undo across several prefs).

## Targeting (#988 rules)

Both new capabilities take `target: 'chart'`, so they go through the chart kind's targeting (clicked chart, deixis, relation, "Which chart?"). They add no rule of their own. `agentChartMenu.test.jsx` (real panel, 2×2 board, every watermark dragged):
- the clicked chart is reset; the other three charts' opts are byte-identical (wrong-target control); "undo that" puts it back exactly;
- "the one above this" (clicked c2) resets c0, and c2 keeps its watermark; a plan on the clicked chart for that sentence is not run (#988: the anchor is never the target);
- Ask AI opens the clicked chart's symbol only, after the receipt, with no Undo button; "the one next to this" opens the neighbour's symbol; a chart with no door (e.g. a Multi Chart cell) is refused and nothing opens.

## Routing

One new group `chartMenu` (`domains: ['chartMenu']`, `fillLast: true`, `wordsOnly: true`), between `compareGroups` and `chartGrid`. Every existing group is character-identical to master (`git diff origin/master -- app/src/agent/routing.js` has 0 removed lines). Words (no lookbehind):
- Ask AI needs a verb + "ai" + about / on / for / regarding, or "ask (the) ai" with a chart / stock / symbol / ticker word;
- the watermark needs a reset / back / default / original / recenter / "where it was" word, in either order.
Negative controls (`nlm1Routing.test.js`, `agentChartMenu.test.jsx`): "make the watermark bigger", "hide the watermark", "send this chart to my journal", "ask about nvda earnings", "show the header", "reset the view", "what does the ai search widget say" and more do not select it. `OWN_WORDS.chartMenu` has 4 phrases, each sent on v2's first call.

**Declared groups: 27** (master 26 + chartMenu). Server `turn.py` MAX_GROUPS is 24 on master, 32 after PR #1089. Other queued PRs add about 6 groups.

**First calls, master vs this branch, 3650 requests** (`evidence/chart-rclick/v2-first-calls.md`): v1 0 differ, v2 0 differ, in→out 0, out→in 0. No request in those sets carries chartMenu.

## Tests (focused, single files per run, ≤25 files, no lock; node_modules is a junction to C:\w\pl-mc-fw\app\node_modules)

- Run A (24 files, **2556/2556**, `evidence/chart-rclick/runA.txt`). Count pins: agentRouting FULL 164 → **166** and agentScreener 158 → **160**, each with its arithmetic in the comment (+ chartMenu.askAi + chartMenu.resetWatermark). agentNl1Selection (core) and agentIndicatorsM2 are unchanged and green: the NL-1 core does not include chartMenu. Also in the run: routeReachability; agentNoLookbehindEquivalence (no frozen row changed); noRegexLookbehind; capreg corpus.routing / routingV2 / inventory / golden / routingCollision (v1 and v2); agentContracts; nlm1Routing; the #988 targeting rails (agentRelativeChart, agentTargetTruth, agentDeixis); the new tests (agentChartMenu, ChartWidget.rclickParity); the ChartWidget menu tests (paneMenu, openSettings, agent, ChartWidget).
- Run B (`evidence/chart-rclick/runB.txt`): agentNl1SelectionCoverage, no loss: corpus 174/182, dev-nl1 43/43, heldout-v1 164/165 first call (budget 55), the same as master. agentExecReach, all pins hold, list held-out v2 8/8. agentWidgetControls 56/56. widgetJournal.outcome 7/7. chartSettings.outcome (C1-061's old x/y row) green. agentScanSat1Requests failed only on the recorded planner requests and was re-recorded in its OWN commit (120 insertions, 0 removals, every hunk is the chartMenu group listing). Re-run: 62/62.
- capreg corpus intents `chartMenu.resetWatermark` (board WATERMARK: 3 phrasings + undo, `expect.watermarkPos: null`) and `chartMenu.askAi` (board TIMED: 3 phrasings, `expect.askAiOpened`). finalState slices: 7/7. The harness gained a WATERMARK board, the TIMED board's Ask AI door (recorded) and two expect keys (`watermarkPos`, `askAiOpened`).
- Generated, each in its own run: capreg coverage (UPDATE_CAPREG=1) and `baseline.lock.json` (`tests/test_uct_agent_capreg_baseline.py --update`, additive: 40 lines); `manifest.golden.json` (UPDATE_AGENT_GOLDEN=1, +44 lines); `tests/fixtures/nl1_assemble_parity.json` (UPDATE_NL1_PARITY=1, +29 lines).
- pytest (venv pl-grid), the golden / parity / section_b readers + capreg_baseline + nl1_selection (19 files): everything passes except `test_uct_agent_nl1_selection.py::test_a_routed_nl1_request_is_three_cache_blocks_core_first`. That test fails **only because of MAX_GROUPS = 24**: with 27 groups, `guide` falls past the server's cut. With `turn.MAX_GROUPS = 32` (PR #1089's value) patched in, the file passes 17/17. `tests/test_uct_agent_contract.py` needed the new domain in its `_GROUP_OF` map (a test file, not server code). No server Python and no knowledge/guard.py were touched.

- Full `tests/test_uct_agent*.py` once: 4130 passed, 2 failed. (1) The MAX_GROUPS test above. (2) `test_uct_agent_v2_cost_measure.py` flagship worst case: the two new manifest entries moved planner v2's (off) summed worst case from master's $0.3496 to $0.3505, past the pinned $0.3454 + $0.005 growth allowance ($0.3504). The baseline may not be raised without the owner, so both summaries and hints were shortened instead: now **$0.3504, exactly at the limit**, and the test passes. The golden was regenerated; parity, capreg and SAT-1 did not move. Re-run of the 21 affected server test files: 959 passed, 1 failed (the MAX_GROUPS test). ⚠ This PR uses the last of the flagship growth allowance. The next manifest growth on master will need the owner's v2 cost decision, or more trimming.
- eslint on every changed source and test file is clean apart from errors already on master: chart.js 980-981 (`no-useless-escape`, from bc20f6f6c9), the ChartWidget.jsx 372 ref-cleanup warning, and nlm1Routing.test.js's existing multiline `it.each` (line 163).

## Status rows (CHARTS_EXECUTION_STATUS.md, updated here)

C1-176 MISSING → VERIFIED (SIMULATED). C1-178 MISSING → VERIFIED (SIMULATED). C1-061 PARTIAL → VERIFIED (SIMULATED). C1-177 MISSING → PARTIAL (destination only). C1-100 and C2-041 stay MISSING, now with the ownership STOP stated.

## Requests to try live (a chart on /charts)

1. "reset the watermark" after dragging the watermark: it goes back to the centre. Then "undo that": it returns to where it was dragged.
2. "reset the watermark" on a chart whose watermark was never moved: "already in its default place", and nothing is written.
3. With two charts, click one, then "ask AI about this chart": the receipt shows first, then that chart's stock opens on Research → AI.
4. "send this chart to my journal": the proposal card first. On Apply it lands where the right-click "Send to Journal" puts it.
5. Negative: "make the watermark bigger" is still chart.setSetting (watermark size), not a reset.
