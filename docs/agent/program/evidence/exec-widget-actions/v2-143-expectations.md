# v2 first calls that differ from master — expectation table (#1027 at 40ce2e82a0)

Evidence class: LOCAL, node (vitest for the dumps), deterministic routing only, no model. The v2 dumps are `routeManifestV2` (charts ctx: surface charts, createIndicator, manageIndicators; production limit / budget; lexicon typo readings) over 3636 requests, run on master `24a4b8350b` (temp worktree, removed) and on this branch's code at `40ce2e82a0`. A request "differs" when its selected groups differ from master's once watchlistShow is set aside: **143** requests.

Expectation: the corpus's own expected action(s). For NL intent sets that is `expect.ops` / `expect.alt` (in = some plan fully routed). For the NLM-1 dev paraphrases it is `needs`. For agentExec sets it is the action the reach test measures. Held-out sets are listed by id only.

| result | count |
|---|---:|
| in→in | 23 |
| out→in | 0 |
| out→out | 2 |
| in→out | 0 |
| no expectation (not counted above) | 118 |

No expectation, by source: lb.routing 115, corpus.json 2, heldout-v2.json 1 (`lb.routing` is the lookbehind regex-equivalence corpus, which has no expected actions).

## Rows with an expectation

| id | set | expected action(s) | result | groups on master | groups at 40ce2e82a0 |
|---|---|---|---|---|---|
| nlm1-dev[20] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[21] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[33] | nlm1 dev paraphrases | chart.setSetting | in→in | charts,chartGrid,screener,alerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,boardEdit,screener,data,breadth,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[87] | nlm1 dev paraphrases | stock.earnings | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[120] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[121] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[122] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,screener,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,screener,alerts,indicatorAlerts,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[123] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[126] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[127] | nlm1 dev paraphrases | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[129] | nlm1 dev paraphrases | agent.undo | in→in | charts,chartGrid,boardEdit,indicatorSetup,definitions,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide | charts,chartGrid,boardEdit,indicatorSetup,alerts,indicatorAlerts,breadth,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[137] | nlm1 dev paraphrases | chartGrid.set | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[138] | nlm1 dev paraphrases | chartGrid.set | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[140] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[147] | nlm1 dev paraphrases | screener.run | in→in | charts,chartGrid,indicatorSetup,definitions,screener,alerts,indicatorAlerts,breadth,calendar,agent,undo,guide | charts,chartGrid,indicatorSetup,definitions,screener,alerts,breadth,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[155] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[156] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| nlm1-dev[157] | nlm1 dev paraphrases | news.latest | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| corpus.json:slang-07 | corpus.json | screener.run | out→out | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| corpus.json:ticker-04 | corpus.json | chart.setSymbol | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| corpus.json:recover-04 | corpus.json | chart.setTimeframe | in→in | charts,chartGrid,indicators,definitions,alerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,indicators,alerts,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| heldout-v1.json:h-ticker-02 | heldout-v1.json (held-out) | chart.setSymbol | in→in | charts,chartGrid,indicators,definitions,alerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,indicators,alerts,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| heldout-v1.json:h-screen-14 | heldout-v1.json (held-out) | screener.run | out→out | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| heldout-v1.json:h-ref-18 | heldout-v1.json (held-out) | stock.profile | in→in | charts,chartGrid,definitions,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,alerts,indicatorAlerts,data,breadth,settings,calendar,agent,undo,watchlistShow,guide |
| heldout-v1.json:h-recover-03 | heldout-v1.json (held-out) | chart.setTimeframe | in→in | charts,chartGrid,indicators,definitions,alerts,breadth,settings,calendar,agent,undo,guide | charts,chartGrid,indicators,alerts,breadth,settings,calendar,agent,undo,watchlistShow,guide |
