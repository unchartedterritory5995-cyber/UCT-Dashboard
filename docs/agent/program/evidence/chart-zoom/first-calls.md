# Routing v1 and v2 first calls, master vs chart zoom

Evidence class: LOCAL, node (vitest for the dump), deterministic routing only, no model, no backend.

- Master: `7a2c1fae47` (origin/master at branch time), in a temporary sparse worktree (`app/`, `tests/`), removed after.
- Branch: `agent/pl/chart-zoom` at `a34a4eae55` (the routing, capability and corpus commits; later commits change only the zoom hints text and docs, which no routing reads).
- Method: #1084's (`docs/agent/program/evidence/wordsonly-fill/`), extended to v1. The same dump test ([dump.test.js.txt](dump.test.js.txt), temporary, not committed as a test) ran once in each tree and wrote every request's first call: `routeManifest` (v1) and `routeManifestV2` (v2), charts ctx (surface charts, createIndicator, manageIndicators), production limit / budget, lexicon typo readings, catalog registered by `registerCatalog()`. The two dumps were compared row by row ([compare.cjs.txt](compare.cjs.txt)); the row ids line up 1:1.
- Sets (3650 requests): lb.routing 2745, NLM-1 dev paraphrases 162, NL-1 corpus.json 220, dev-nl1.json 64, heldout-v1.json 196, heldout-v2.json 176, agentExec held-out and tune sets 87. Held-out rows would be listed by id only (none differ).
- Expectation: NL sets `expect.ops` / `expect.alt` (in = some plan fully in the first call); NLM-1 dev `needs`; agentExec the action the reach test measures. 789 rows carry one.

## Result

| | v1 | v2 |
|---|---:|---:|
| requests | 3650 | 3650 |
| selected groups differ | 1 | 1 |
| in→in | 1 | 1 |
| out→in | 0 | 0 |
| out→out | 0 | 0 |
| **in→out** | **0** | **0** |
| differing, no expectation | 0 | 0 |
| rows with an expectation, in on master | 643 / 789 | 676 / 789 |
| rows with an expectation, in on the branch | 643 / 789 | 676 / 789 |
| first calls carrying `chartView` | 1 | 1 |

The one differing row, in both routers:

| id | set | expected | result | groups on master | groups on the branch |
|---|---|---|---|---|---|
| nlm1-dev[24] | NLM-1 dev paraphrases (not held-out) | chart.setTimeframe | in→in | charts,agent | charts,agent,chartView |

It is "zoom out to monthly bars": the chartView words add the group, nothing is removed, and the timeframe action stays in the call. The zoom hints now say that "zoom out to weekly / monthly bars" is a timeframe (chart.setTimeframe).

No other row moved: chartView is words-only and fillLast, last in GROUPS, so no unrecognised request's fill and no existing group's place changed.
