# Routing v1 and v2 first calls: master vs agent/pl/chart-rclick-parity

Master `7a2c1fae47` (origin/master at branch time) vs this branch at `e536a25f92`. Routing is unchanged after that commit: the later commits are SAT-1, status rows, docs, lint and shorter chartMenu summary/hint text (manifest text only, no group, word or action change). LOCAL, deterministic, no model.

Method: `dump.test.js.txt` here, the #1027 / wordsonly-fill method (docs/agent/program/evidence/wordsonly-fill/), extended to dump routing v1 (`routeManifest`) beside v2 (`routeManifestV2`). It ran once on the untouched worktree (master) and once on this branch; the two JSON dumps were compared row by row (same row order; ids repeat inside some sets, so rows are matched by index). Inputs: the lookbehind corpus, NLM-1 dev, NL-1 corpus / dev-nl1 / heldout-v1 / heldout-v2, the agentExec held-out and tune sets: **3650 requests**. "Differ" = the selected groups or the sent action names differ, ignoring the new chartMenu actions themselves. Held-out rows are counted by set only; no held-out text is quoted.

| set | n | with expectation | v1 in (master → this) | v2 in (master → this) | v1 first calls that differ | v2 first calls that differ | v1 in→out | v2 in→out | carry chartMenu |
|---|---|---|---|---|---|---|---|---|---|
| lb.routing | 2745 | 0 | 0 → 0 | 0 → 0 | 0 | 0 | 0 | 0 | 0 |
| nlm1 dev paraphrases | 162 | 162 | 142 → 142 | 161 → 161 | 0 | 0 | 0 | 0 | 0 |
| corpus.json | 220 | 182 | 167 → 167 | 162 → 162 | 0 | 0 | 0 | 0 | 0 |
| dev-nl1.json | 64 | 43 | 41 → 41 | 41 → 41 | 0 | 0 | 0 | 0 | 0 |
| heldout-v1.json (held-out) | 196 | 165 | 148 → 148 | 145 → 145 | 0 | 0 | 0 | 0 | 0 |
| heldout-v2.json (held-out) | 176 | 150 | 130 → 130 | 128 → 128 | 0 | 0 | 0 | 0 | 0 |
| agentExec widget held-out (held-out) | 24 | 24 | 1 → 1 | 7 → 7 | 0 | 0 | 0 | 0 | 0 |
| agentExec widget tune | 24 | 24 | 1 → 1 | 7 → 7 | 0 | 0 | 0 | 0 | 0 |
| agentExec widget tune2 | 5 | 5 | 0 → 0 | 2 → 2 | 0 | 0 | 0 | 0 | 0 |
| agentExec list held-out (held-out) | 8 | 8 | 7 → 7 | 8 → 8 | 0 | 0 | 0 | 0 | 0 |
| agentExec list tune | 5 | 5 | 5 → 5 | 5 → 5 | 0 | 0 | 0 | 0 | 0 |
| agentExec name held-out2 (held-out) | 6 | 6 | 0 → 0 | 1 → 1 | 0 | 0 | 0 | 0 | 0 |
| agentExec door held-out2 (held-out) | 4 | 4 | 0 → 0 | 1 → 1 | 0 | 0 | 0 | 0 | 0 |
| agentExec journal held-out2 (held-out) | 4 | 4 | 0 → 0 | 3 → 3 | 0 | 0 | 0 | 0 | 0 |
| agentExec journal tune2 | 4 | 4 | 0 → 0 | 4 → 4 | 0 | 0 | 0 | 0 | 0 |
| agentExec search held-out7 (held-out) | 3 | 3 | 1 → 1 | 1 → 1 | 0 | 0 | 0 | 0 | 0 |
| **total** | **3650** | 789 | 643 → 643 | 676 → 676 | **0** | **0** | **0** | **0** | 0 |

Result: **no first call changed** under v1 or v2 (0 of 3650 each), **in→out 0**, out→in 0. No request in these sets names the chartMenu group, so it is never sent (words-only: it is not a filler, and v2's index does not score it).
