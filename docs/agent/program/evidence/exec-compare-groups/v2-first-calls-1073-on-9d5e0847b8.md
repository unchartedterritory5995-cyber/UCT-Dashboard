# #1073 re-merge onto 9d5e0847b8: routing v2 first calls vs master — expectation table

Evidence class: LOCAL, node (vitest for the dumps), deterministic routing only, no model. `routeManifestV2` through the capreg `routedNames(text, { v2: true })` (charts ctx: surface charts, createIndicator, manageIndicators; production limit / budget; lexicon typo readings; nlm1 dev `recentActions` / `after` passed), over the same request sets as the a15b666119 table and #1027 / #1084: the lookbehind corpus (`noLookbehind/baseline.json` corpus.routing, 2745), NLM-1 dev paraphrases (162), NL-1 corpus.json / dev-nl1.json / heldout-v1.json / heldout-v2.json (turns by their `say`, no history), and the agentExec held-out / tune sets of agentExecReach (host-less). Run on master `9d5e0847b8` (temp worktree, removed) and on the merged tree (#1073 `8913cbd2ca` + master), the same 3650 requests in the same order, 0 skipped. Dump script: the #1084 method (`evidence/wordsonly-fill/dump.test.js.txt`), with `routedNames` in place of the side-by-side module copy, plus a `wordsSelect('compareGroups', text)` column on the merged tree (temp file, not committed). Held-out rows are listed by id only; no held-out text appears here.

A request "differs" when its selected groups, its sent groups or its expectation result differ: **0** requests.

On a15b666119 the 405 differing requests all came from compareGroups riding routing v2's step-6 fill. #1084 (`routingV2.js`: a `wordsOnly` group is filler only when its own words name the message) removes that, so compareGroups (wordsOnly) is now sent only on its own words. None of the 3650 requests carries compareGroups' words (`wordsSelect('compareGroups', ·)` is false on all 3650), so no first call moves. Its own-words reach is covered by the #1084 rail (`nlm1Routing.test.js` OWN_WORDS.compareGroups, 3 phrases built from its own words, not from any held-out set) and by agentCompareGroups.

| result | count |
|---|---:|
| in→in | 0 |
| out→in | 0 |
| out→out | 0 |
| in→out | **0** |
| no expectation (not counted above) | 0 |

Over all 789 rows with an expectation: in on master 676, in on the merged tree 676.

## Rows with an expectation

None differ.
