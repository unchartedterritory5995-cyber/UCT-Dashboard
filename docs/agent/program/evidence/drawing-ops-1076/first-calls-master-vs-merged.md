# #1076 re-merged onto 64421f770d: first calls, master vs merged

Evidence class: LOCAL, node (vitest dump), deterministic routing only, no model. Script: [dump.test.js.txt](dump.test.js.txt), a temp test that is not committed. The same script ran in two places:

- a clean temp worktree at origin/master `64421f770d`;
- the FINAL #1076 tree (head measured: see "Measured head" below).

Charts context (surface charts, createIndicator, manageIndicators); limit = maxCapabilities, budget = routingThreshold 55; lexicon typo readings; `registerCatalog()`. The sets are the same as docs/agent/program/evidence/wordsonly-fill: 3650 requests, 789 of them with an expectation. Held-out rows are named by id only.

## Final tree (Lead decision: drawingOps is a words-only group)

| router | rows whose selected groups differ | in→in | out→in | out→out | in→out | in on master / merged (of 789) |
|---|---:|---:|---:|---:|---:|---|
| routeManifestV2 | **0** | 0 | 0 | 0 | **0** | 676 / 676 |
| v1 routeManifest | **0** | 0 | 0 | 0 | **0** | 643 / 643 |

h2-data-09, C3-148 and nlm1-dev[128–131] are back: every row selects exactly master's groups.

SAT-1 section B (`agentScanSat1Requests`) was regenerated in its own commit. Every one of its 30 hunks is the drawingOps entry in a request's `routing.groups` listing. With that entry removed, the file is identical to master's as JSON. No request's `selected` groups moved, and no request lost a group. scan/eval are untouched.

One drift was removed on the way. In the first merge and in an intermediate tree, one row with no expectation (lb.routing[247], not held-out) moved. The cause was #1076's own hint text, which added "choose" to the typo lexicon, so "chooses"→"choose" became a typo reading. The hint now says "The side is the position's own — never ask the member", and the row is back to master's selection.

## Controls (nlm1Routing.test.js, "#1076 drawingOps controls"): selected groups

| router | message | selected | reaches |
|---|---|---|---|
| v1 | alert me at 150 | alerts, agent | alert.create |
| v1 | set an alert on NVDA | alerts, agent | alert.create |
| v1 | duplicate my RSI | boardEdit, indicators, indicatorSetup, agent | indicatorCopy.duplicate |
| v2 | alert me at 150 | alerts, agent | alert.create |
| v2 | set an alert on NVDA | alerts, agent | alert.create |
| v2 | duplicate my RSI | boardEdit, indicators, indicatorSetup, agent | indicatorCopy.duplicate |
| v2 | create a custom copy of the rsi indicator | boardEdit, indicators, indicatorSetup, definitions, indicatorAlerts, agent | definition.duplicate |

None of them selects drawingOps, and `wordsSelect('drawingOps', …)` is false for each. "duplicate my RSI" reaches indicatorSetup (indicatorCopy.duplicate, the copy on the chart), not definitions, on both routers. That is the same as before #1076. definition.duplicate is a v2 reach for "create a custom copy of …", as duplicateRouting.test.js pins.

## Superseded: the first merge, before the Lead decision (STOP)

drawing.setPositionAlerts was in `alerts` and drawing.duplicate was in `drawings`. Measured on 41b4fdd9ba:

- v2: 588 rows differed, with 2 in→out: heldout-v2 h2-data-09 (`data` cut) and agentExec widget tune C3-148 (`boardEdit` cut).
- v1: 4 in→out, nlm1-dev[128–131] (agent.undo: the 1-action undo group was cut from the fill on 905 rows).
- SAT-1: 6 scan requests lost `screener` from the first call.

The cause was one more action in a non-fillLast fill group, while the nothing-recognised fill sits exactly at the 55-action budget.

## Measured head

The first-call dumps and the controls were measured on the tree committed as `523eed87a1`. `c96e2e5953` adds only the SAT-1 capture, which no JS reads. Master is `64421f770d`.
