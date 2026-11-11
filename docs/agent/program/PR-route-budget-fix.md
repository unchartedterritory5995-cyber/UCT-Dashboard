# PR: routing v2 budget-cut ties pack smallest first (widget.readOptions reachable again)

Branch `agent/pl/route-budget-fix`, from origin/master `999d1e297f`, with the reachability rail (`agent/pl/route-reachability` `8b8a67f75d`) merged in. T2: one routing rule in `nlm1/routingV2.js`. Only routing v2 (production) changes; v1 (kill-switch fallback) is untouched.

## Cause

Under routing v2 the message's own groups are packed in this order: v1's regex hits first, then v2's "strong" scored groups, best score first. When they do not all fit in the 55-action budget, the lowest-scoring groups are cut.

"how is that one set right now" (→ `widget.readOptions`, boardEdit) matches v1's workspace words ("right"). v2 then scores four groups as strong, all from the one generic word "set" (BM25): charts 2.08, lists 2.07, drawings 2.04, boardEdit 2.00. Best-first packing gives charts 21 + workspace 13 + lists 17 + agent 1 = 52. Drawings (12) and boardEdit (5) no longer fit. So the small group the message names was cut on a 0.08 score difference, while two big co-selected groups were sent.

## Rule change

`routeManifestV2` (step 2, "own"):

- If v1's hits plus v2's strong groups all **fit**, nothing changes (best-first, as before). Order inside a tier that fits does not change what gets packed.
- If they **don't fit**, the strong groups are sorted by evidence and split into bands. A group joins the current band when its score is within `TUNING.TIE` = 0.9 (10%) of the band's best. Each band is packed **smallest first**, which is v1's own packing principle. Bands stay in evidence order, so a clearly stronger group still goes first. Only near-ties are re-ordered, and the big co-selected groups give way first.
- v1's hits keep their D2.1 order. Pinned, critical, likely and fill tiers are unchanged. No phrase rules, no regex (so no lookbehind), and the 60 limit and 55 budget are not touched.

For the defect phrasing the head sends agent 1 + workspace 13 + boardEdit 5 + drawings 12 + lists 17 = **48**. Charts is the group that gets cut.

## Before / after reachability (every registered action, real routers)

The rail (`routeReachability.test.js`) runs on the head. `widget.readOptions` was removed from the frozen `UNREACHABLE.v2` list, and nothing was added. A local probe running the same sources (corpus, golden, open NL sets, `reachPhrasings.json`) also compared every (phrasing, action) pair. "Master" is the head with the rule reverted, which gives master's routing outcome.

| | master | head |
|---|---|---|
| v2 unreachable, PROD kinds (167 actions) | guide.explain, widget.readOptions | guide.explain |
| v2 unreachable, ALL kinds (176) | guide.explain, widget.readOptions | guide.explain |
| v1 unreachable (unchanged, v1 not touched) | calendar.nextReport, definition.duplicate, drawing.add, guide.explain, journal.createNote, journal.listNotes, stock.themes, widget.readOptions, widget.setOption | same |
| (phrasing, action) pairs carried, v2 | — | **0 lost**, 1 gained (widget.readOptions) |
| max actions in any v2 request | 55 | 55 (≤ 55 holds) |
| v2 routes whose group set or cut changed | — | 20 of 1081 (PROD), 27 (ALL) |

guide.explain stays unreachable because the fast path answers it, not because of the budget.

### The 20 changed PROD v2 routes: expected action before / after (AUDIT GO evidence 1)

Each row is a phrasing whose routed v2 request changed, keyed by its source id. The expected action comes from the corpus intent needs and model ops, the golden step ops, or the NL set expect.ops. Before means master (the rule reverted); after means head. For held-out sources only the id is shown, never the text. Sealed sets are never read.

**Result: 0 regressions** (no expected action is in before and out after). 1 fix: #13. "how is that one set right now" expects widget.readOptions (boardEdit). Nothing it expects lives in charts, so cutting charts there is not a regression.

| # | source id | board | message | expected action | before (master) | after (head) |
|---|---|---|---|---|---|---|
| 1 | corpus board.duplicateChart | HALF | "make a copy of the NVDA chart" | board.duplicateChart | in | in |
| 2 | corpus drawing.addLevel | DRAW | "draw a price line at 200 on this chart" | drawing.addLevel | in | in |
| 3 | corpus chart.closeTab | ONE | "close the Swing tab" (after chart.addTab) | chart.closeTab | in | in |
| 4 | corpus chart.closeTab | ONE | "close that tab" (after chart.addTab) | chart.closeTab | in | in |
| 5 | corpus indicator.preview-draft | AUTHOR | "let me see what it looks like on the chart" (after indicator.draft) | indicator.previewDraft | in | in |
| 6 | corpus indicator.save-draft-as | AUTHOR | "save it as Thrust Days" (after indicator.draft) | indicator.saveDraft | in | in |
| 7 | corpus indicator.save-draft-as | AUTHOR | "ok save it, call it Thrust Days" (after indicator.draft) | indicator.saveDraft | in | in |
| 8 | corpus indicator.followup-daily-only | AUTHOR | "only show it on the daily" (after indicator.draft,indicator.add) | indicatorStyle.set | in | in |
| 9 | corpus indicator.followup-daily-only | AUTHOR | "show it on daily charts only" (after indicator.draft,indicator.add) | indicatorStyle.set | in | in |
| 10 | corpus indicator.followup-daily-only | AUTHOR | "make it daily only" (after indicator.draft,indicator.add) | indicatorStyle.set | in | in |
| 11 | corpus indicator.followup-other-chart (before) | AUTHOR_TWO | "make an indicator on the QQQ chart that marks days where close is above the 21 EMA and volume is 1.5x the 50-day average" | indicator.draft | in | in |
| 12 | corpus watchlist.sortColumn | LISTVIEW | "sort the Momentum list by RVOL high to low" | watchlist.sortColumn | in | in |
| 13 | corpus widget.readOptions | ONE | "how is that one set right now" | widget.readOptions | OUT | in |
| 14 | corpus widget.sendToJournal.no-door | ONE | "keep a copy of that one" | widget.sendToJournal | in | in |
| 15 | golden GW-22.new-chart-then-rsi-on-it | HALF | "open a chart for AMD" | widget.addCharts | in | in |
| 16 | nl corpus.json typo-09 | null | "hide volumn" | volume.setState | in | in |
| 17 | nl dev-nl1.json d-cas-04 | null | "hide the volumn" | volume.setState | in | in |
| 18 | nl dev-nl1.json d-p2-17 | null | "make this chart weekly and add the 50" | chart.setTimeframe | in | in |
| 18 | nl dev-nl1.json d-p2-17 | null | "make this chart weekly and add the 50" | indicator.add | in | in |
| 19 | nl heldout-v1.json h-screen-02 | null | (held-out: text withheld) | screener.run | in | in |
| 20 | nl heldout-v1.json h-safety-19 | null | (held-out: text withheld) | layout.rename | in | in |

### agentExecReach [reach] lines, master vs head (AUDIT GO evidence 2)

agentExecReach.test.jsx was run on head and on master routing (the rule reverted). Its [reach] output is **byte-identical** in the two runs: every set has the same model / action / list counts, so no set drops. 23/23 tests pass on both. Counts only (the misses name held-out phrasings):

| set | router | model | action | list |
|---|---|---|---|---|
| widget held-out | v1 | 24/24 | 21/24 | 21/24 |
| widget held-out | v2 | 24/24 | 21/24 | 21/24 |
| widget tune | v1 | 24/24 | 20/24 | 21/24 |
| widget tune | v2 | 24/24 | 21/24 | 21/24 |
| list held-out | v1 | 8/8 | 7/8 | — |
| list held-out | v2 | 8/8 | 8/8 | — |
| list tune | v1 | 5/5 | 5/5 | — |
| list tune | v2 | 5/5 | 5/5 | — |
| name held-out2 | v1 | 6/6 | 5/6 | 5/6 |
| name held-out2 | v2 | 6/6 | 5/6 | 5/6 |
| door held-out2 | v1 | 4/4 | 4/4 | 4/4 |
| door held-out2 | v2 | 4/4 | 4/4 | 4/4 |
| journal held-out2 | v1 | 4/4 | 4/4 | — |
| journal held-out2 | v2 | 4/4 | 4/4 | — |
| widget tune2 | v1 | 5/5 | 5/5 | 5/5 |
| widget tune2 | v2 | 5/5 | 5/5 | 5/5 |
| journal tune2 | v1 | 4/4 | 4/4 | — |
| journal tune2 | v2 | 4/4 | 4/4 | — |
| search held-out7 | v1 | 3/3 | 3/3 | 3/3 |
| search held-out7 | v2 | 3/3 | 3/3 | 3/3 |

### Budget cuts per group across all 1081 PROD v2 routes (`overBudget`, which is what `warnBudgetCut` logs)

| group | master | head |
|---|---|---|
| chartSetup | 30 | 38 |
| lists | 19 | 21 |
| charts | 15 | 15 |
| indicators | 15 | 12 |
| workspace | 7 | 7 |
| data | 5 | 6 |
| boardEdit | 4 | 5 |
| layouts / screener / indicatorAlerts | 5 / 5 / 5 | 4 / 3 / 3 |
| indicatorSetup | 4 | 3 |
| breadth / definitions / alerts / drawings | 3 / 2 / 1 / 1 | 0 / 0 / 0 / 0 |
| routes at the full 55 | 72 | 71 |

chartSetup (16) is now the group cut most often. As the second-largest group in a near-tie it gives way first. Upcoming chartSetup growth will make that more frequent, and none of those cuts lose a needed action today. boardEdit's 5 head cuts are all pairs whose needed action is in another group.

## Group headroom after the fix (PROD kinds, charts surface, budget 55, hard limit 60)

Group sizes don't change. "Alone" is the room left when the group rides with agent (1) only. The tie rule decides who is cut when strong groups overflow, so a small group named in a near-tie now survives growth of its large co-selected neighbours. The large groups lose this protection first.

| group | size | alone: 55 − 1 − size |
|---|---|---|
| charts | 21 | 33 |
| lists | 17 | 37 |
| chartSetup | 16 | 38 |
| workspace | 13 | 41 |
| drawings | 12 | 42 |
| indicators | 12 | 42 |
| layouts | 9 | 45 |
| screener, data, drawingTools | 8 | 46 |
| settings, indicatorSetup | 6 | 48 |
| boardEdit | 5 | 49 |
| alerts, indicatorAlerts, definitions | 4 | 50 |
| breadth, guide | 2 | 52 |
| chartGrid, agent, undo, calendar | 1 | 53 |

The defect phrasing on head uses 48 of 55, so boardEdit can grow by 7 before that request overflows again. drawings (+12 → 60) would be the next cut there, and boardEdit would not be.

## Tests (LOCAL, native Windows Node, vitest; 24 files, under the 25-file limit)

**24 files / 2665 tests passed.** The files: agentRouting, agentExecReach, agentNl1Selection, agentNl1SelectionCoverage, agentNoLookbehindEquivalence, noRegexLookbehind, nlm1Routing, routingV1Identity, nlm1Workflows, corpus.routing, corpus.routingV2, routingCollision, routingCollisionV2, corpus.dark, routeReachability, inventory, golden, agentRoutingS6, agentRoutingScreenConditions, agentRoutingLayoutStabilization, agentCoachRoutingParity, agentItOnThatChart, agentWidgetControls, agentWidgetOptions.

- **No-lookbehind equivalence rail:** green with **no frozen output changed**. No regex was touched.
- **routingV1Identity:** green (v1 is byte-identical).
- **Corpus gap GAP-WIDGET-READ-ROUTE:** this gap was shared by the v1 and v2 level-(a) tests. v2 now passes it, and v1 still fails it as expected. The gap is now marked `"router": "v1"`, and `corpus.routingV2.test.js` runs a v1-only gap as a normal case. Its reason was updated, and coverage.json and COVERAGE.md were regenerated (`UPDATE_CAPREG=1`).
- **Mutant** (the rule reverted to best-first): the rail fails with `routing v2: NEW unreachable actions: widget.readOptions [boardEdit] CUT BY THE BUDGET`, and the corpus v2 case for "how is that one set right now" fails. After restoring the rule the diff is empty.

**After merging the rail's final head 89f5f756cd** (rate-limited budget-cut log): the same 24 files give 24 passed / **2668 passed**. The rail reports a v2 budget cut on 97/1081 distinct phrasings (9.0%), with chartSetup 38, lists 21, charts 15 and indicators 12. These match this doc's probe counts.

## Files (git diff --stat origin/master...HEAD)

```
app/src/agent/nlm1/routingV2.js
app/src/agent/qa/capabilityRegression/baseline/corpus.json
app/src/agent/qa/capabilityRegression/baseline/reachPhrasings.json
app/src/agent/qa/capabilityRegression/corpus.routingV2.test.js
app/src/agent/qa/capabilityRegression/coverage/COVERAGE.md
app/src/agent/qa/capabilityRegression/coverage/coverage.json
app/src/agent/qa/capabilityRegression/routeReachability.test.js
app/src/agent/qa/capabilityRegression/testing/route.js
app/src/agent/routing.js
docs/agent/program/PR-route-budget-fix.md
docs/agent/program/PR-route-reachability.md
```

(includes the merged reachability rail branch 8b8a67f75d; this PR's own files: routingV2.js, corpus.json, corpus.routingV2.test.js, coverage.json, COVERAGE.md, routeReachability.test.js, this doc)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
