# v2 first calls, master vs #1074 re-merged — Layout Dock bar actions

Evidence class: LOCAL, node (vitest for the dump), deterministic routing only, no model. `routeManifestV2` first calls (charts ctx: surface charts, createIndicator, manageIndicators; production limit / budget; lexicon typo readings; catalog registered as `registerCatalog()`), on master `64421f770d` (temp detached worktree, removed after) and on #1074 re-merged onto it. Same method and sets as `../wordsonly-fill/` except that each tree ran the dump against its OWN registry and routing (the change is in `routing.js` GROUPS and the catalog, not in `routingV2.js`), and the two outputs were joined by row id. Dump script: [dump.test.js.txt](dump.test.js.txt) (temp, not committed as a test).

Sets (3650 requests): `lb.routing` (baseline.json `corpus.routing`); NLM-1 dev paraphrases; NL-1 corpus.json, dev-nl1.json, heldout-v1.json, heldout-v2.json; agentExec widget/list/name/door/journal/search held-out and widget/list/journal tune sets. Held-out rows are named by id only.

## Result

A request "differs" when its selected groups differ: **0** of 3650.

| result | count |
|---|---:|
| in→in | 0 |
| out→in | 0 |
| out→out | 0 |
| in→out | **0** |

Over all 774 rows with an expectation: in on master 665, in on the re-merge 665. The new `layoutBar` group was sent on no row of these sets (it is words-only, and none of them names the bar).

## Routing interactions found by the re-merge (fixed in the group design)

1. **NL-1 first-call coverage, corpus.json `ws-11` (layout.duplicate)**: with #1074's three bar actions inside `layouts`, that group no longer fit NL-1's 55 beside the core and the other selected group, so `layouts` was dropped from the first call (master: 174/182 first call; re-merge before the fix: 173/182). Fix: the three actions moved to their OWN words-only group `layoutBar` (`actions:` by name, `fillLast`, `wordsOnly`), like `watchlistShow` (#1027) and `compareGroups` (#1073); `layouts` is byte-identical to master. After: corpus 174/182, dev 43/43, heldout-v1 164/165 — per-request identical to master (no request lost).
2. **agentExecReach list held-out (C1-065, chart.setSetting `header.barInfo`)**: #1074's "a place on the bar" word also matched the chart header's bar-info readout, adding a group that cost the row its first call (v1 7/8 → 6/8, v2 8/8 → 7/8). Fix: the bar word refuses a bar-info noun after "bar" (`info|readouts?|data|values?|legend|strip`, a lookahead; no lookbehind). After: v1 7/8, v2 8/8 = master.

No new tie or size rule. The nlm1Routing words-only rail has `layoutBar` phrases in OWN_WORDS.

## OPEN (Lead decision): the server's 24-group cap

Master already sends exactly 24 routing groups, and `api/services/uct_agent/turn.py` `MAX_GROUPS = 24` keeps only the first 24 (`validate_routing`). `layoutBar` is the 25th, so the last group (`guide`) falls off the server's "other action groups" list and `need_groups` enum. `tests/test_uct_agent_nl1_selection.py::test_a_routed_nl1_request_is_three_cache_blocks_core_first` fails on it (passes on master). Not changed here: raising the cap is a server-contract change outside the routing/group design.
