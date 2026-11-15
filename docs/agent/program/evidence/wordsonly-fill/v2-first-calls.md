# v2 first calls that differ from master — wordsOnly fill fix

Evidence class: LOCAL, node (vitest for the dump), deterministic routing only, no model. `routeManifestV2` first calls (charts ctx: surface charts, createIndicator, manageIndicators; production limit / budget; lexicon typo readings; catalog registered as `registerCatalog()`), master `a15b666119` vs this branch (`819beca18e`), in ONE run: master's `routingV2.js` copied beside the fixed one as an untracked temp module (removed after), so the inputs, manifest and options are byte-identical. Dump script: [dump.test.js.txt](dump.test.js.txt) (temp, not committed as a test).

Sets (3650 requests, same as #1027's method): `lb.routing` = the lookbehind regex-equivalence corpus (baseline.json `corpus.routing`, 2745); NLM-1 dev paraphrases (162); NL-1 corpus.json (220), dev-nl1.json (64, each turn without history), heldout-v1.json (196), heldout-v2.json (176); agentExec widget/list/name/door/journal/search held-out and widget/list/journal tune sets (87). Held-out rows are listed by id only.

Expectation: NL sets `expect.ops` / `expect.alt` (in = some plan fully in the first call); NLM-1 dev `needs`; agentExec the action the reach test measures (widget.setOption / chart.setSetting / widget.sendToJournal).

A request "differs" when its selected groups differ: **150**. Every one of the 150 is master's selection minus `watchlistShow`, plus at most one group: `definitions` 139, `indicatorAlerts` 3, nothing 8. No other group moved on any row. `watchlistShow` was in 153 master first calls; with the fix in 3, each named by its own words (lb.routing[69], dev-nl1.json:d-uns-03, heldout-v2.json:h2-unsupported-06), unchanged.

| result | count |
|---|---:|
| in→in | 23 |
| out→in | 0 |
| out→out | 3 |
| in→out | **0** |
| no expectation (not counted above) | 124 |

No expectation, by source: lb.routing 121, corpus.json 2 (slang-10, screen-12), heldout-v2.json 1 (h2-screen-15).

Over all 789 rows with an expectation: in on master 676, in with the fix 676.

## Rows with an expectation

| id | set | expected action(s) | result | groups on master a15b666119 | groups with the fix |
|---|---|---|---|---|---|
| nlm1-dev[20] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[21] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[33] | nlm1 dev paraphrases | chart.setSetting | in→in | charts,chartGrid,boardEdit,screener,data,breadth,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,boardEdit,screener,data,breadth,calendar,agent,undo,guide |
| nlm1-dev[87] | nlm1 dev paraphrases | stock.earnings | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[120] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[121] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[122] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,screener,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,screener,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[123] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[126] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[127] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[129] | nlm1 dev paraphrases | agent.undo | in→in | charts,chartGrid,boardEdit,indicatorSetup,alerts,indicatorAlerts,breadth,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,boardEdit,indicatorSetup,definitions,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide |
| nlm1-dev[137] | nlm1 dev paraphrases | chartGrid.set | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[138] | nlm1 dev paraphrases | chartGrid.set | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[140] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[147] | nlm1 dev paraphrases | screener.run | in→in | charts,chartGrid,indicatorSetup,definitions,screener,alerts,breadth,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,indicatorSetup,definitions,screener,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide |
| nlm1-dev[155] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[156] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| nlm1-dev[157] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| corpus.json:slang-07 | corpus.json | screener.run | out→out | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| corpus.json:ticker-04 | corpus.json | chart.setSymbol | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| corpus.json:ref-04 | corpus.json | layout.open | out→out | charts,chartGrid,boardEdit,indicatorSetup,alerts,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,boardEdit,indicatorSetup,alerts,breadth,settings,calendar,agent,undo,guide |
| corpus.json:recover-04 | corpus.json | chart.setTimeframe + chart.setTimeframe | in→in | charts,chartGrid,indicators,alerts,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,indicators,definitions,alerts,breadth,settings,calendar,agent,undo,guide |
| heldout-v1.json:h-ticker-02 | heldout-v1.json (held-out) | chart.setSymbol | in→in | charts,chartGrid,indicators,alerts,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,indicators,definitions,alerts,breadth,settings,calendar,agent,undo,guide |
| heldout-v1.json:h-screen-14 | heldout-v1.json (held-out) | screener.run | out→out | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| heldout-v1.json:h-ref-18 | heldout-v1.json (held-out) | stock.profile | in→in | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide |
| heldout-v1.json:h-recover-03 | heldout-v1.json (held-out) | chart.setTimeframe + chart.setTimeframe | in→in | charts,chartGrid,indicators,alerts,breadth,settings,calendar,agent,undo,watchlistShow,guide | charts,chartGrid,indicators,definitions,alerts,breadth,settings,calendar,agent,undo,guide |
