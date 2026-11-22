# PR: route reachability rail and budget-cut log

Branch `agent/pl/route-reachability`, cut from origin/master `999d1e297f`. Tests only, plus one log line. There is no routing change and nothing members can see.

## Problem

Routing gives the model whole capability groups, packed under the per-request budget (`manifest.contract.json` `routingThreshold` = 55). When one group grows, the packing can push another group out of the request with no error. For example, adding to chartSetup once cut `indicatorTemplate.apply`. The action is still registered, but the phrasings that need it never show it to the model. No rail checked this for every action. `agentExecReach` only samples held-out sets.

## Read-only check on master `999d1e297f` (before the rail)

Every registered action (production kinds: 167) was run through the real routers with its own phrasings, via `testing/route.js`, the same call useAgent makes. Phrasings came from:

- corpus intents: needs, model ops and `before` steps
- golden workflow steps
- the open NL sets (dev and exposed; the sealed sets were never opened)

Results:

- **Live budget cut, routing v2 (production):** `widget.readOptions` [boardEdit]. Its phrasing "how is that one set right now" wants boardEdit. Charts 21 + workspace 13 + lists 17 + agent 1 = 52, which leaves no room for boardEdit (5) under 55.
- **Unreachable for reasons other than the budget:**
  - `guide.explain`: "what is rsi" is answered by the fast path.
  - `drawing.add`, v1 only: "draw an arrow …" routes drawings, not drawingTools.
- **No phrasing at all:** 27 actions (listed in `baseline/reachPhrasings.json`).

## Change

1. `qa/capabilityRegression/baseline/reachPhrasings.json` (corpus only): one plain member phrasing for each of the 27 unmeasured actions. These are routing phrasings only and make no plan or state claims. Optional `surface` (for page actions on breadth, calendar, journal and screener) and optional `board`.
2. `qa/capabilityRegression/routeReachability.test.js`: the rail. No model calls.
   - Every registered action has at least one phrasing. Any that do not are listed by name.
   - Under routing v2 and under v1, every action is in the routed request after the budget cut for at least one phrasing.
   - The unreachable set is **frozen** at master's known cases in `UNREACHABLE.v2` / `UNREACHABLE.v1`, each with its cause. It is **shrink-only**: an action that becomes reachable is allowed (a console line asks for its entry to be removed). A new unreachable action fails, shown as `name [group] CUT BY THE BUDGET | group not selected`.
   - Frozen v2 cases: `widget.readOptions` (budget cut) and `guide.explain` (fast path).
   - Frozen v1 cases: those two, `drawing.add`, and six cases first measured by the new phrasings (v2 reaches all six): `calendar.nextReport`, `definition.duplicate`, `journal.createNote`, `journal.listNotes`, `stock.themes`, `widget.setOption`.
3. `testing/route.js`: `routedNames` takes `surface` (default `charts`, so existing behaviour is unchanged).
4. Runtime guard: `routing.js` `warnBudgetCut`, called by `routeManifest` and by `routeManifestV2`. When the budget cuts a group the request needed, one `console.warn` names the groups and their actions. It never includes the message text.
   - v1 needed groups: pinned, the message's own groups, a carried answer, soft vocabulary. Fallback fill groups are not logged, because past the catalog size they are expected not to fit.
   - v2 needed groups: its existing `overBudget` list.
   - No lookbehind regex. The output is unchanged.
   - Rate-limited: one line per distinct set of cut groups per page session (a module-level Set keyed on the sorted group names, capped at 256). Tests: the same set twice gives one warn, a different set gives a second, and the selection is unchanged. This is checked both directly and through the real v2 routing.
5. `baseline/corpus.json`: the GAP-WIDGET-READ-ROUTE reason is corrected. Under v2 this is the budget cut (52 used), not "no words of its own". The v1 wording is kept for the level that runs v1. Coverage was regenerated with `UPDATE_CAPREG=1`.

## Evidence (LOCAL, native Windows Node, vitest)

- Focused set, 17 files: **2378 passed**. The files: routeReachability, inventory, golden, corpus.routing, corpus.routingV2, routingCollision(V2), agentRouting, agentRoutingS6, nlm1Routing, routingV1Identity, agentNl1Selection(+Coverage), agentIsolationL5, qa/isolationLayers, agentNoLookbehindStrings, agentManifestCaps.
- **Mutant:** `routingThreshold` 55 → 50 turns the rail red under v2 with `widget.setOption [boardEdit] CUT BY THE BUDGET`. v1 stayed green (no v1 phrasing loses an action at 50). Restored afterwards; the diff is empty.
- **Scale-step branch** (`agent/pl/scale-step-exec` `3cae4f658c`, adds `chartSetup.stepBars` and `chartSetup.autoScale` to boardEdit, so boardEdit becomes 7 and the registry 169): the rail is green both on that branch as it stands and merged onto this head (with inventory: 684 passed). The unreachable set stays within master's; nothing is added.

## Measured budget pressure (routing v2, master + this branch's phrasings)

Over every distinct corpus phrasing the rail reads (text, board, surface and recent actions; 1081 in all), **97 (9.0%)** have their v2 routing cut by the budget: the router wanted at least one group it could not carry. The groups cut most often are chartSetup 30, lists 19, indicators 15, charts 15, workspace 7, then data, layouts, screener and indicatorAlerts at 5 each, indicatorSetup and boardEdit at 4, breadth 3, drawingTools and definitions at 2, and alerts, drawings and settings at 1. The rail prints this line on every run.

## Group sizes against the 55 budget (production kinds, charts surface, master)

charts 21, lists 17, chartSetup 16, workspace 13, drawings 12, indicators 12, layouts 9, screener 8, data 8, drawingTools 8, settings 6, indicatorSetup 6, boardEdit 5, alerts 4, indicatorAlerts 4, definitions 4, breadth 2, guide 2, chartGrid 1, agent 1, undo 1, calendar 1.

## Files (git diff --stat origin/master...HEAD)

```
app/src/agent/nlm1/routingV2.js
app/src/agent/qa/capabilityRegression/baseline/corpus.json
app/src/agent/qa/capabilityRegression/baseline/reachPhrasings.json
app/src/agent/qa/capabilityRegression/coverage/COVERAGE.md
app/src/agent/qa/capabilityRegression/coverage/coverage.json
app/src/agent/qa/capabilityRegression/routeReachability.test.js
app/src/agent/qa/capabilityRegression/testing/route.js
app/src/agent/routing.js
docs/agent/program/PR-route-reachability.md
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
