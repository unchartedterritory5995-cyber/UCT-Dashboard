# #1070 re-merge onto 1208aa0085: routing v1 and v2 first calls vs master

Evidence class: LOCAL, node (vitest for the dumps), deterministic routing only, no model. Measured head: `102c9a52c6` (the merge commit; its routing code is the tree dumped), against master `1208aa0085`. Both trees ran the same dump ([dump.test.js.txt](dump.test.js.txt), temp, not committed as a test): capreg `routedNames(text, { v2 })` for v1 and v2 (charts ctx: surface charts, createIndicator, manageIndicators; production limit / budget; lexicon typo readings; nlm1 dev `recentActions` / `after` passed). master was dumped from a temporary detached worktree (removed after).

Sets (3650 requests, the wordsonly-fill method): `lb.routing` (2745), NLM-1 dev paraphrases (162), NL-1 corpus.json (220), dev-nl1.json (64), heldout-v1.json (196), heldout-v2.json (176), agentExec widget/list/name/door/journal/search held-out and widget/list/journal tune sets (87). Held-out rows are listed by id only.

A request "differs" when its selected groups, its sent group ids (with the new group's own name set aside: every request now names `drawingBoards` among the unselected groups) or its expectation result differ.

The first attempt (#1070's board verb added to the `drawings` group, +4 actions in that group) gave in→out 0 but moved 80 v2 first calls (the drawings group outsized the fill: -drawings 38, +calendar 27, -breadth 25, +workspace 24, …) and 5 v1. The fix: the four actions in their OWN `wordsOnly` + `fillLast` group `drawingBoards`, drawings character-identical to master, the board noun only governed by its verb within two words. Its only remaining selections on these 3650 are three held-out requests that name a LAYOUT whose name ends in "board"; each only adds `drawingBoards`, nothing leaves, and each was out on master too.

## routing v1 (routeManifest)

Requests whose selected groups, sent group ids (the new `drawingBoards` name aside) or expectation result differ: **3**.

| result | count |
|---|---:|
| in→in | 0 |
| out→in | 0 |
| out→out | 2 |
| in→out | **0** |
| no expectation | 1 |

Over all 789 rows with an expectation: in on master 643, in on the merged tree 643.

| id | set | result | groups on master | groups on the merged tree |
|---|---|---|---|---|
| heldout-v1.json:h-safety-09 | heldout-v1.json (held-out) | out→out | charts,workspace,agent | charts,workspace,drawingBoards,agent |
| heldout-v2.json:h2-ws-06 | heldout-v2.json (held-out) | out→out | charts,workspace,agent | charts,workspace,drawingBoards,agent |
| heldout-v2.json:h2-safety-02 | heldout-v2.json (held-out) | no expectation | charts,workspace,agent | charts,workspace,drawingBoards,agent |

## routing v2 (routeManifestV2)

Requests whose selected groups, sent group ids (the new `drawingBoards` name aside) or expectation result differ: **3**.

| result | count |
|---|---:|
| in→in | 0 |
| out→in | 0 |
| out→out | 2 |
| in→out | **0** |
| no expectation | 1 |

Over all 789 rows with an expectation: in on master 676, in on the merged tree 676.

| id | set | result | groups on master | groups on the merged tree |
|---|---|---|---|---|
| heldout-v1.json:h-safety-09 | heldout-v1.json (held-out) | out→out | charts,workspace,agent | charts,workspace,drawingBoards,agent |
| heldout-v2.json:h2-ws-06 | heldout-v2.json (held-out) | out→out | charts,workspace,agent | charts,workspace,drawingBoards,agent |
| heldout-v2.json:h2-safety-02 | heldout-v2.json (held-out) | no expectation | charts,workspace,agent | charts,workspace,drawingBoards,agent |
