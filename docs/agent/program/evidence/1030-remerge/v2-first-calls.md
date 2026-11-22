# #1030 re-merge: routing v2 first calls, master vs merged

## Final: measured on head `9902cb9bc9` (2026-11-11)

Same method and request sets as below. `routeManifestV2` first calls on master `64421f770d` vs the committed tree at `9902cb9bc9`, which includes the "switch to … group" lookahead. Both runs used the same 3635 requests (identical id sets). The temp dump was removed after the run. **0 requests differ**, in selected groups or in whether the expected plan is fully in the first call: in→in 0, out→in 0, out→out 0, **in→out 0**. In with an expectation: master 665/774, `9902cb9bc9` 665/774.

History: before link/lock was limited to crosshair / time range, an intermediate tree had one difference, `corpus.json:ws-14` (widget.setLink, in→in). v1 frozen no-lookbehind rows (2745): 0 changed on this head (agentNoLookbehindEquivalence green).

## Before the decisions (merge `951f7b9419`): STOPPED

Evidence class: LOCAL, node (vitest), deterministic routing only, no model. `routeManifestV2` first calls with the same inputs as `docs/agent/program/evidence/wordsonly-fill/` (charts ctx: surface charts, createIndicator, manageIndicators; production limit / budget; lexicon typo readings; `registerCatalog()`). The dump (that file's `dump.test.js.txt`, reduced to one tree) ran once in a temporary detached worktree of master `64421f770d` and once in the merged #1030 tree `951f7b9419`. Both trees hold the same request sets. Held-out rows are listed by id only.

Requests: 3635. A request "differs" when its selected groups differ: **320**.

| result | count |
|---|---:|
| in→in | 62 |
| out→in | 1 |
| out→out | 19 |
| in→out | **2** |
| no expectation (not counted above) | 236 |

Over all 774 rows with an expectation: in on master 665, in merged 664.

**STOP: 2 in→out.** `corpus.json:slang-08` (expects screener.run): the multiChart group enters the fill and `screener` drops out. `agentExec widget held-out:C3-172` (expects widget.setOption): `boardEdit` drops out of the fill (no multiChart added; the fill shifted). Cause: #1030's `multiChart` group is `fillLast` but NOT `wordsOnly`, so routing v2 uses it as filler (#1027 / #1084 rule: a niche group is never filler).

Experiment (NOT committed): with `wordsOnly: true` on the multiChart group, 29 requests differ from master: in→in 6, no expectation 21, out→out 2. 0 in→out.

## Rows with an expectation

| id | set | expected action(s) | result | groups on master 64421f770d | groups merged |
|---|---|---|---|---|---|
| corpus.json:slang-08 | corpus.json | screener.run | in→out | charts,chartGrid,boardEdit,indicatorSetup,screener,alerts,breadth,calendar,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,alerts,breadth,settings,calendar,agent,undo,guide |
| agentExec widget held-out:C3-172 | agentExec widget held-out (held-out) | widget.setOption | in→out | charts,boardEdit,data,settings,agent | charts,data,settings,agent |
| heldout-v2.json:h2-screen-02 | heldout-v2.json (held-out) | screener.run / screener.runSaved | out→in | charts,indicators,data,agent | charts,indicators,screener,data,agent |
| corpus.json:slang-07 | corpus.json | screener.run | out→out | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| corpus.json:screen-05 | corpus.json | screener.run | out→out | charts,chartGrid,indicators,definitions,alerts,indicatorAlerts,settings,calendar,agent,undo | charts,chartGrid,multiChart,indicators,definitions,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide |
| corpus.json:screen-10 | corpus.json | screener.run | out→out | charts,chartGrid,indicators,definitions,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide | charts,chartGrid,multiChart,indicators,definitions,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide |
| corpus.json:ref-04 | corpus.json | layout.open | out→out | charts,chartGrid,boardEdit,indicatorSetup,alerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,alerts,breadth,settings,calendar,agent,undo,guide |
| corpus.json:ref-10 | corpus.json | layout.open | out→out | charts,chartGrid,boardEdit,indicatorSetup,alerts,indicatorAlerts,breadth,settings,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,indicatorAlerts,breadth,settings,calendar,agent,undo,guide |
| heldout-v1.json:h-screen-14 | heldout-v1.json (held-out) | screener.run | out→out | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| heldout-v1.json:h-screen-16 | heldout-v1.json (held-out) | screener.run | out→out | chartSetup,workspace,lists,agent | chartSetup,workspace,multiChart,lists,agent |
| heldout-v1.json:h-mi-22 | heldout-v1.json (held-out) | stock.earnings | out→out | charts,chartGrid,indicatorSetup,definitions,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,indicatorSetup,definitions,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,guide |
| heldout-v1.json:h-safety-10 | heldout-v1.json (held-out) | layout.delete | out→out | charts,chartGrid,boardEdit,definitions,alerts,indicatorAlerts,data,breadth,calendar,agent,undo | charts,chartGrid,boardEdit,multiChart,definitions,alerts,indicatorAlerts,data,calendar,agent,undo |
| heldout-v1.json:h-typo-09 | heldout-v1.json (held-out) | layout.open | out→out | charts,chartGrid,boardEdit,alerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,alerts,data,breadth,settings,calendar,agent,undo |
| heldout-v2.json:h2-screen-09 | heldout-v2.json (held-out) | screener.run | out→out | charts,chartGrid,indicatorSetup,definitions,lists,alerts,agent,undo | charts,chartGrid,multiChart,definitions,lists,alerts,breadth,agent,undo,guide |
| heldout-v2.json:h2-ws-11 | heldout-v2.json (held-out) | layout.open | out→out | charts,chartGrid,boardEdit,alerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,alerts,data,breadth,settings,calendar,agent,undo |
| heldout-v2.json:h2-ref-15 | heldout-v2.json (held-out) | watchlist.remove | out→out | charts,chartGrid,boardEdit,indicatorSetup,drawings,indicatorAlerts,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide |
| agentExec widget held-out:C3-183 | agentExec widget held-out (held-out) | widget.setOption | out→out | workspace,indicators,agent | workspace,indicators,lists,agent |
| agentExec widget held-out:C3-148 | agentExec widget held-out (held-out) | widget.setOption | out→out | charts,chartSetup,chartGrid,data,breadth,calendar,agent,undo,guide | charts,chartSetup,chartGrid,multiChart,data,calendar,agent,undo,guide |
| agentExec widget held-out:C3-206 | agentExec widget held-out (held-out) | widget.setOption | out→out | indicators,data,agent | multiChart,indicators,data,agent |
| agentExec widget tune:C3-166 | agentExec widget tune | widget.setOption | out→out | charts,chartGrid,indicatorSetup,definitions,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,indicatorSetup,definitions,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,guide |
| agentExec name held-out2:C3-195 | agentExec name held-out2 (held-out) | widget.setOption | out→out | charts,drawings,breadth,settings,agent | charts,drawings,data,breadth,settings,agent |
| agentExec door held-out2:C3-121 | agentExec door held-out2 (held-out) | widget.setOption | out→out | charts,drawingTools,lists,agent | charts,drawings,lists,agent |
| nlm1-dev[18] | nlm1 dev paraphrases | definition.search | in→in | indicators,definitions,agent | chartSetup,indicators,definitions,agent |
| nlm1-dev[20] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[21] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[33] | nlm1 dev paraphrases | chart.setSetting | in→in | charts,chartGrid,boardEdit,screener,data,breadth,calendar,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,screener,data,breadth,calendar,agent,undo,guide |
| nlm1-dev[36] | nlm1 dev paraphrases | chart.goToDate | in→in | charts,chartSetup,chartGrid,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide | charts,chartSetup,chartGrid,multiChart,indicatorAlerts,breadth,calendar,agent,undo,guide |
| nlm1-dev[55] | nlm1 dev paraphrases | widget.addCharts | in→in | charts,chartGrid,workspace,settings,agent | charts,chartGrid,workspace,agent |
| nlm1-dev[67] | nlm1 dev paraphrases | screener.run | in→in | charts,indicators,screener,breadth,agent | charts,indicators,screener,data,breadth,agent |
| nlm1-dev[85] | nlm1 dev paraphrases | stock.quote | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,definitions,alerts,indicatorAlerts,data,breadth,calendar,agent,undo,guide |
| nlm1-dev[87] | nlm1 dev paraphrases | stock.earnings | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[93] | nlm1 dev paraphrases | stock.themes | in→in | charts,chartGrid,indicators,alerts,data,breadth,calendar,agent,undo,guide | chartSetup,multiChart,indicators,data,agent |
| nlm1-dev[95] | nlm1 dev paraphrases | breadth.show | in→in | charts,chartGrid,indicatorSetup,definitions,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,indicatorSetup,definitions,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[99] | nlm1 dev paraphrases | settings.setDefaultTimeframe | in→in | charts,workspace,settings,agent | charts,workspace,data,settings,agent |
| nlm1-dev[107] | nlm1 dev paraphrases | agent.undo | in→in | charts,chartGrid,boardEdit,indicatorSetup,drawings,indicatorAlerts,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide |
| nlm1-dev[108] | nlm1 dev paraphrases | indicatorStyle.set | in→in | charts,chartGrid,indicators,indicatorSetup,drawingTools,calendar,agent,undo,guide | charts,chartGrid,multiChart,indicators,indicatorSetup,drawingTools,calendar,agent,undo,guide |
| nlm1-dev[120] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[121] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[122] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,screener,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,screener,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[123] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[126] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[127] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[129] | nlm1 dev paraphrases | agent.undo | in→in | charts,chartGrid,boardEdit,indicatorSetup,definitions,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide |
| nlm1-dev[131] | nlm1 dev paraphrases | agent.undo | in→in | charts,chartGrid,boardEdit,indicatorSetup,drawings,breadth,calendar,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,drawings,breadth,agent,undo,guide |
| nlm1-dev[137] | nlm1 dev paraphrases | chartGrid.set | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[138] | nlm1 dev paraphrases | chartGrid.set | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[140] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[147] | nlm1 dev paraphrases | screener.run | in→in | charts,chartGrid,indicatorSetup,definitions,screener,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide | charts,chartGrid,multiChart,indicatorSetup,definitions,screener,alerts,breadth,calendar,agent,undo,guide |
| nlm1-dev[155] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[156] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[157] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| corpus.json:typo-09 | corpus.json | volume.setState | in→in | charts,indicators,lists,agent | charts,multiChart,indicators,lists,agent |
| corpus.json:ticker-04 | corpus.json | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| corpus.json:ticker-06 | corpus.json | chart.setSymbol | in→in | charts,workspace,indicators,settings,agent | charts,workspace,multiChart,indicators,settings,agent |
| corpus.json:ticker-07 | corpus.json | chart.setSymbol | in→in | charts,chartGrid,boardEdit,indicators,indicatorSetup,breadth,calendar,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicators,indicatorSetup,breadth,agent,undo,guide |
| corpus.json:ticker-08 | corpus.json | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,definitions,alerts,indicatorAlerts,data,breadth,calendar,agent,undo,guide |
| corpus.json:ws-04 | corpus.json | layout.saveCurrent | in→in | chartSetup,layouts,indicators,definitions,screener,agent,guide | chartSetup,multiChart,layouts,indicators,definitions,screener,agent,guide |
| corpus.json:ref-03 | corpus.json | chart.setTimeframe | in→in | charts,chartGrid,boardEdit,indicatorSetup,definitions,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,definitions,alerts,indicatorAlerts,breadth,agent,undo,guide |
| corpus.json:ref-14 | corpus.json | chart.applyTheme | in→in | charts,workspace,agent | charts,multiChart,agent |
| corpus.json:recover-04 | corpus.json | chart.setTimeframe + chart.setTimeframe | in→in | charts,chartGrid,indicators,definitions,alerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,indicators,alerts,breadth,settings,calendar,agent,undo,guide |
| corpus.json:live-01 | corpus.json | chartGrid.set | in→in | charts,chartGrid,workspace,indicatorAlerts,data,settings,agent | charts,chartGrid,workspace,alerts,indicatorAlerts,data,agent |
| corpus.json:live-03 | corpus.json | chartGrid.set | in→in | charts,chartGrid,workspace,agent | charts,chartGrid,workspace,multiChart,agent |
| dev-nl1.json:d-cas-01 | dev-nl1.json | chart.setTimeframe | in→in | charts,chartGrid,boardEdit,indicatorSetup,alerts,indicatorAlerts,breadth,settings,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,indicatorAlerts,breadth,settings,calendar,agent,undo,guide |
| dev-nl1.json:d-cas-04 | dev-nl1.json | volume.setState | in→in | charts,indicators,lists,agent | charts,multiChart,indicators,lists,agent |
| dev-nl1.json:d-ref-03 | dev-nl1.json | chart.setTimeframe | in→in | charts,workspace,agent | charts,chartGrid,workspace,agent |
| dev-nl1.json:d-multi-03 | dev-nl1.json | watchlist.add + watchlist.open | in→in | charts,boardEdit,lists,agent | charts,lists,agent |
| heldout-v1.json:h-ticker-02 | heldout-v1.json (held-out) | chart.setSymbol | in→in | charts,chartGrid,indicators,definitions,alerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,indicators,alerts,breadth,settings,calendar,agent,undo,guide |
| heldout-v1.json:h-slang-03 | heldout-v1.json (held-out) | chart.setSession | in→in | charts,chartSetup,chartGrid,boardEdit,breadth,calendar,agent,undo,guide | charts,chartSetup,chartGrid,boardEdit,multiChart,breadth,calendar,agent,undo,guide |
| heldout-v1.json:h-alt-12 | heldout-v1.json (held-out) | chart.goToDate | in→in | charts,chartSetup,chartGrid,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide | charts,chartSetup,chartGrid,multiChart,indicatorAlerts,breadth,calendar,agent,undo,guide |
| heldout-v1.json:h-alt-23 | heldout-v1.json (held-out) | chart.setSetting | in→in | charts,chartGrid,settings,agent | charts,chartGrid,multiChart,settings,agent |
| heldout-v1.json:h-mi-09 | heldout-v1.json (held-out) | breadth.history | in→in | indicators,alerts,breadth,agent | indicators,breadth,agent |
| heldout-v1.json:h-ref-01 | heldout-v1.json (held-out) | chart.setSymbol | in→in | charts,chartGrid,boardEdit,alerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,alerts,data,breadth,settings,calendar,agent,undo |
| heldout-v1.json:h-ref-16 | heldout-v1.json (held-out) | chart.setSymbol | in→in | charts,chartGrid,boardEdit,indicatorSetup,alerts,indicatorAlerts,data,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide |
| heldout-v1.json:h-ref-18 | heldout-v1.json (held-out) | stock.profile | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| heldout-v1.json:h-recover-03 | heldout-v1.json (held-out) | chart.setTimeframe + chart.setTimeframe | in→in | charts,chartGrid,indicators,definitions,alerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,multiChart,indicators,alerts,breadth,settings,calendar,agent,undo,guide |
| heldout-v1.json:h-multi-03 | heldout-v1.json (held-out) | layout.saveAs + layout.open | in→in | chartSetup,boardEdit,workspace,layouts,agent | chartSetup,boardEdit,workspace,multiChart,layouts,agent |
| heldout-v1.json:h-slang-07 | heldout-v1.json (held-out) | chart.setTimeframe | in→in | charts,chartGrid,boardEdit,indicatorSetup,alerts,indicatorAlerts,breadth,settings,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,indicatorAlerts,breadth,settings,calendar,agent,undo,guide |
| heldout-v2.json:h2-tf-02 | heldout-v2.json (held-out) | chart.setTimeframe | in→in | charts,chartGrid,boardEdit,indicatorSetup,alerts,indicatorAlerts,breadth,settings,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,indicatorAlerts,breadth,settings,calendar,agent,undo,guide |
| heldout-v2.json:h2-tf-18 | heldout-v2.json (held-out) | chart.addCustomTimeframe | in→in | charts,chartGrid,boardEdit,indicatorSetup,alerts,indicatorAlerts,breadth,settings,agent,undo,guide | charts,chartGrid,boardEdit,multiChart,indicatorSetup,indicatorAlerts,breadth,settings,calendar,agent,undo,guide |
| heldout-v2.json:h2-tf-22 | heldout-v2.json (held-out) | chart.setTimeframe | in→in | charts,indicators,settings,agent | charts,settings,agent |
| heldout-v2.json:h2-ws-01 | heldout-v2.json (held-out) | layout.open | in→in | charts,layouts,agent | charts,multiChart,layouts,agent |
| agentExec widget held-out:C3-166 | agentExec widget held-out (held-out) | widget.setOption | in→in | boardEdit,settings,agent | boardEdit,indicators,settings,agent |
| agentExec list tune:C1-066 | agentExec list tune | chart.setSetting | in→in | charts,lists,data,calendar,agent | charts,multiChart,lists,data,calendar,agent |
| agentExec list tune:C1-065 | agentExec list tune | chart.setSetting | in→in | charts,agent | charts,breadth,agent |
