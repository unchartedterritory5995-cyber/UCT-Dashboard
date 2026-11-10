# PR: knowledge guard withholds bare capability action names (finding G1)

Branch `agent/pl/knowledge-guard-bare-names`, stacked on #1030 (`agent/pl/exec-multichart-grid`, origin `5f5bdcd7e6`).
**Merge order: this merges AFTER #1030.** It edits the ratchet file #1030 adds
(`tests/test_uct_agent_server_capability_mirrors.py`), so it cannot land first. Rebase onto master after #1030 merges;
`git merge-tree` against origin/master `16c653db95` is clean today.

## The finding

`api/services/uct_agent/knowledge/guard.py` screens retrieved brain-pack passages, including curated verbatim trader
posts, for prompt injection. The feature is dark and admin-only. A passage that names an Agent action is meant to be
withheld. The guard enumerated families x verbs by hand, so it failed OPEN on **45 of the 159** Charts manifest names
when written bare, i.e. with no "run/call/use" in front (`chart.goToDate`, `watchlist.keepOnly`,
`indicatorTemplate.apply`, `agent.undo`, `calendar.day`...). #1030 froze those 45 in a shrink-only ratchet. Counting
the registry's surface-scoped and flag-gated names too (coach, journal, history, playbook, research, `stock.quote`),
**58 of 178** passed.

## The fix

The guard's action clause is now built from the capability registry, the single source, when the module is imported:

* `app/src/agent/contract/manifest.golden.json` is the manifest the Charts surface sends. `agentContracts.test.js`
  keeps it equal to the registry.
* The registry source `app/src/agent/capabilities/*.js` (no tests) adds its `name: 'x.y'` and `CAPABILITY = 'x.y'`
  literals and its `KNOWLEDGE_CAPS` keys. These cover the families the Charts golden doesn't carry.

Result: 178 names in 32 families. A passage is withheld when it contains `family.verb`, where the verb is either:
* one of the registry's single-word verbs, with any suffix (case-insensitive, as before), or
* any camelCase identifier (case-sensitive).

So `watchlist.exportList` and `board.setLayout` are caught even though neither is a registered name. A sloppy
`breadth.Then` or `volume.so` is not caught.

A new capability is covered with no guard edit. If the registry can't be read, the guard fails CLOSED on any dotted
camelCase identifier, and `guard.action_source()` reports `"fallback"`. The web image copies the whole tree
(`COPY . /app`), so the source is present at runtime.

Ratchet: `GUARD_KNOWN_UNWITHHELD` is now empty. The rule is kept as a comment: the set may only stay empty.

## Tests (failing first)

| commit | what |
|---|---|
| `76f63d712a` | tests only. Before the fix: ratchet lists the 45; registry rail 58 open; PLANTED 7/10 pass the guard; `action_families`/`action_clause` missing. 5 G1 failures. |
| `8dac880bfb` | the fix, `guard.py`. |
| `3a3496d6fd` | #1030's board-domain test called `turn.validate_manifest(CAPS)` with all 159 caps. The per-request limit is 60, so it raised `TurnError` instead of asserting. Now `limit=len(CAPS)`. **#1030 needs the same one-line fix, or its CI is red.** |
| `1fdad827b9` | AUDIT precondition in `docs/feature_flags.json`. |

New rails in `tests/test_uct_agent_server_capability_mirrors.py`:
* families are derived (manifest prefixes and registry-literal prefixes are in `action_families()`; source == registry)
* a NEW family (`zebraFamily.doThing`) is matched by `action_clause` with no edit
* every registry literal name is withheld bare
* **PLANTED**: 10 quoted trader posts embedding a bare name mid-sentence (`board.setLayout grid`,
  `watchlist.exportList`, `chart.goToDate 2024-03-01`, `playbook.record`...). All must be withheld.
* **CONTROLS**: 34 ordinary trading-prose passages using set / export / layout / list / grid / board / replay /
  compare / undo / day / history normally. This includes the no-space typos `breadth.Then`, `volume.so`,
  `chart.It` and the domains `news.google.com`, `stock.twits`. Over-flag must be 0.

## Verification (no local pytest; standalone runner)

The runner imports the test modules with a pytest stub, expands parametrize, and runs every test in the mirrors file
plus every `*guard*` test in `tests/test_uct_agent_knowledge.py` (fixture tests skipped).

* At `76f63d712a`: 43 passed, 6 failed (5 G1 rails plus #1030's limit bug).
* After the fix: **49 passed, 0 failed.**
* **False-positive check:** 0 of 34 controls flagged. The existing knowledge-guard precision lists still pass.
  Old guard vs new guard over all 816 string constants in `tests/test_uct_agent_knowledge*.py`: 0 newly passed.
  1 newly flagged: the bare literal `stock.profile`, an action name in a `step_result_text` test, never guarded.
* **Mutations**, each red:
  * **M1**: the old hand-typed list restored. 3 fail: PLANTED 7/10 missed, registry 58 open, manifest ratchet 45.
  * **M2**: golden only, no registry scan. 3 fail: PLANTED 1/10 (`playbook.record`), registry 15 open, derived-families rail.
  * **M3**: no camelCase verbs. 4 fail: PLANTED 3/10, registry 24 open, manifest ratchet, new-family rail.
  * **M4**: camelCase test made case-insensitive. 1 fails: over-flag 5/34 controls.

CI/AUDIT runs pytest.

## AUDIT hard precondition

`docs/feature_flags.json` gains a new top-level section, `audit_preconditions.G1_knowledge_guard_bare_action_names`.
It is not a gate, so it is not in `flags`, and the readme says so. **No widening of UCT_AGENT_KNOWLEDGE, UCT_AGENT_DATA
or the knowledge kinds beyond admin until this fix is merged and verified.**

## Known separate item (not fixed here): G2

`turn_v2.domain_for` falls through to `"history"` for any prefix missing from `_DOMAIN_OF`. `calendar.*` is in that
gap (frozen in #1030's `DOMAIN_KNOWN_UNLISTED = {"calendar"}`), so planner v2 tells the model that `calendar.day` /
`calendar.nextReport` live under market-breadth history. A silent misfile, not a refusal. It needs its own
branch: decide the right domain, add `_DOMAIN_OF["calendar"]`, and shrink that freeze to empty.

## Files (git-derived; this doc excluded)

`git diff --stat 5f5bdcd7e6 HEAD`:

```
 api/services/uct_agent/knowledge/guard.py         |  78 ++++++++++++-
 docs/feature_flags.json                           |  19 +++-
 tests/test_uct_agent_server_capability_mirrors.py | 127 ++++++++++++++++++++--
 3 files changed, 207 insertions(+), 17 deletions(-)
```

`git diff --stat origin/master...HEAD` (merge-base `292983f4bc`; includes all of #1030):

```
 api/services/uct_agent/knowledge/guard.py          |  78 +++-
 .../uct_agent/scan/sat/section_b_requests.json     | 120 ++++++
 api/services/uct_agent/turn_v2.py                  |   3 +-
 app/src/agent/agentRouting.test.jsx                |   2 +-
 app/src/agent/builtins.js                          |   2 +
 app/src/agent/capabilities/multiChart.js           | 475 +++++++++++++++++++++
 app/src/agent/contract/manifest.golden.json        | 127 ++++++
 app/src/agent/host.js                              |   5 +-
 .../qa/chartsOutcome/multiChart.outcome.test.jsx   | 379 ++++++++++++++--
 .../chartsOutcome/multiChartGrid.family.test.jsx   | 406 ++++++++++++++++++
 app/src/agent/routing.js                           |  10 +
 app/src/pages/charts/ChartsWorkspace.jsx           |   6 +-
 app/src/pages/charts/grid/GroupPicker.jsx          |  15 +-
 app/src/pages/charts/grid/MultiChartGrid.jsx       |  29 +-
 app/src/pages/charts/grid/MultiChartMenu.jsx       |  64 +--
 app/src/pages/charts/grid/gridGroupActions.js      |  97 +++++
 app/src/pages/charts/grid/gridLayouts.js           |  14 +
 app/src/pages/charts/grid/useGridAgentControl.js   |  81 ++++
 app/src/pages/charts/grid/useMultiChartState.js    |  18 +-
 docs/agent/CHARTS_EXECUTION_STATUS.md              |  59 +--
 docs/agent/program/PR-exec-multichart-grid.md      | 144 +++++++
 docs/feature_flags.json                            |  19 +-
 tests/fixtures/nl1_assemble_parity.json            |  33 +-
 tests/test_uct_agent_contract.py                   |   4 +-
 tests/test_uct_agent_server_capability_mirrors.py  | 201 +++++++++
 25 files changed, 2247 insertions(+), 144 deletions(-)
```

Plus this doc, `docs/agent/program/PR-knowledge-guard-bare-names.md`. No JS product code changed, so the
no-lookbehind rule doesn't apply. The guard is Python.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM
