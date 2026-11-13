# #1082 re-merge: routing v1 and v2 first calls vs master

Evidence class: LOCAL, node (vitest for the dump), deterministic routing only, no model. Head **3e4779be9d** (merge of origin/master `1208aa0085` + the SAT-1 regeneration) vs master `1208aa0085`, in ONE run: master's `routing.js`, `nlm1/routingV2.js` and `nlm1/capabilityIndex.js` copied beside the branch's as untracked temp modules (imports pointed at the master copies; removed after), so inputs and options are byte-identical. Master is given the manifest without `periodSort.*` (master does not register them); the branch gets the full manifest. Method and sets as master's `docs/agent/program/evidence/wordsonly-fill/` (3650 requests: lb.routing 2745, NLM-1 dev 162, NL-1 corpus 220, dev-nl1 64, heldout-v1 196, heldout-v2 176, agentExec held-out / tune 87). Dump script: [remerge-first-calls-dump.test.js.txt](remerge-first-calls-dump.test.js.txt) (temp, not committed as a test). Held-out rows by id only.

Expectation: NL sets `expect.ops` / `expect.alt` (in = some plan fully in the first call); NLM-1 dev `needs`; agentExec the action the reach test measures.

Result: in→out **0** under v1 and v2. The only rows whose groups change are the two C3-206 rows (this PR's own capability, "period sort … grouped by …"), which now also carry the periodSort group; their old widget.setOption expectation was out on master and stays out.

The `namedGroups` change (a docked Period Sort widget's name beside dates does not bring boardEdit alone) needs `names.widgetTypes` containing `periodsort`; this dump passes no board names (as master's method), so it is inert here. It is measured by agentExecSideEffect (668 phrasings, 0 changed) and pinned by agentPeriodSort.test.jsx (2 rows red without it).

### routing v1 (`routeManifest`)

Rows whose selected groups differ: **2** of 3650.

| result | count |
|---|---:|
| in→in | 0 |
| out→in | 0 |
| out→out | 2 |
| in→out | **0** |
| no expectation | 0 |

Over all 789 rows with an expectation: in on master 643, in on this branch 643.

| id | set | expected action(s) | result | groups on master | groups on this branch |
|---|---|---|---|---|---|
| agentExec widget held-out:C3-206 | agentExec widget held-out (held-out) | widget.setOption | out→out | data,agent | data,agent,periodSort |
| agentExec widget tune:C3-206 | agentExec widget tune | widget.setOption | out→out | data,agent | data,agent,periodSort |

### routing v2 (`routeManifestV2`)

Rows whose selected groups differ: **2** of 3650.

| result | count |
|---|---:|
| in→in | 0 |
| out→in | 0 |
| out→out | 2 |
| in→out | **0** |
| no expectation | 0 |

Over all 789 rows with an expectation: in on master 676, in on this branch 676.

| id | set | expected action(s) | result | groups on master | groups on this branch |
|---|---|---|---|---|---|
| agentExec widget held-out:C3-206 | agentExec widget held-out (held-out) | widget.setOption | out→out | indicators,data,agent | indicators,data,agent,periodSort |
| agentExec widget tune:C3-206 | agentExec widget tune | widget.setOption | out→out | indicators,data,agent | indicators,data,agent,periodSort |
