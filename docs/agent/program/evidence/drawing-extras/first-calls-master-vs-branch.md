# First calls, master vs drawing extras — v1 and v2

Evidence class: LOCAL, node (vitest for the dump), deterministic routing only, no model.

Method: the wordsonly-fill method (`docs/agent/program/evidence/wordsonly-fill/`), extended to both routers. The same dump file
([dump.test.js.txt](dump.test.js.txt), temp, not committed as a test) ran once in a detached master worktree (`8660b43615`) and
once in this branch (head `814da8da9a` for the routing change; the group's words are unchanged after it), each with its own
registry (`registerCatalog()`), charts ctx (surface charts, createIndicator, manageIndicators), production limit and budget,
lexicon typo readings. For every request it records `routeManifest` (v1) and `routeManifestV2` (v2): the selected groups, the
manifest size, and whether some expected plan is fully in the first call. Comparison: [cmp.js.txt](cmp.js.txt).

Sets (3650 requests): `lb.routing` (no-lookbehind equivalence corpus, 2745), NLM-1 dev paraphrases (162), NL-1 corpus.json (220),
dev-nl1.json (64), heldout-v1.json (196), heldout-v2.json (176), agentExec widget / list / name / door / journal / search
held-out and tune sets (87). Held-out rows are counted only; no held-out text is quoted here.

| router | requests | selection differs | manifest size differs | in→in | out→in | out→out | **in→out** | with an expectation | in on master | in on branch |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v1 | 3650 | 0 | 0 | 0 | 0 | 0 | **0** | 789 | 643 | 643 |
| v2 | 3650 | 0 | 0 | 0 | 0 | 0 | **0** | 789 | 676 | 676 |

No request in the standard sets uses the group's words, so no first call moved on either router (the in→in / out→out
columns count only rows whose selection changed). `drawingExtras` is words-only and fillLast: it never rides v1's fallback
fill or v2's step-6 fill, so the nothing-recognised fill stays exactly at master's 55 actions, and `drawings` is
character-identical to master.

The group's own words and its controls are pinned in `app/src/agent/nlm1/nlm1Routing.test.js` (v1 and v2 first calls): 6 own
phrasings carry their action, and 7 controls never select it ("draw a line" keeps `drawings`, "set an alert at my stop" keeps
`alerts` with `alert.create`, "favourite NVDA" / "flag NVDA as a favorite" / "star NVDA in my watchlist" / "save this layout as
default" / "reset the chart to its defaults" do not select it).

`app/src/agent/qa/firstCallRatchet.test.js` does not exist on origin/master `8660b43615`, so it was not run.
