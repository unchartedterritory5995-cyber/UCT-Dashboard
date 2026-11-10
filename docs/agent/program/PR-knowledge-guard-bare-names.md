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
| `76f63d712a` | tests only. Before the fix: ratchet lists the 45; registry rail 58 open; PLANTED 7/10 pass the guard; `action_families`/`action_clause` missing. 5 G1 failures (standalone stub runner, not pytest). |
| `8dac880bfb` | the fix, `guard.py`. |
| `3a3496d6fd` | #1030's board-domain test called `turn.validate_manifest(CAPS)` with all 159 caps. The per-request limit is 60, so it raised `TurnError` instead of asserting. Now `limit=len(CAPS)`. **#1030 needs the same one-line fix, or its CI is red.** |
| `1fdad827b9` | AUDIT precondition in `docs/feature_flags.json`. |
| `c141581c77` | AUDIT round 2 (items b, d, e): boot log line + `source_line()`, registry and fallback rails, one planted post per family, precondition reworded. |
| (round 3) | `print(line, flush=True)` in `log_action_source_once()`, and the capfd stdout rail. |

New rails in `tests/test_uct_agent_server_capability_mirrors.py`:
* families are derived (manifest prefixes and registry-literal prefixes are in `action_families()`; source == registry)
* a NEW family (`zebraFamily.doThing`) is matched by `action_clause` with no edit
* every registry literal name is withheld bare
* **PLANTED**: 10 quoted trader posts embedding a bare name mid-sentence (`board.setLayout grid`,
  `watchlist.exportList`, `chart.goToDate 2024-03-01`, `playbook.record`...). All must be withheld.
* **CONTROLS**: 34 ordinary trading-prose passages using set / export / layout / list / grid / board / replay /
  compare / undo / day / history normally. This includes the no-space typos `breadth.Then`, `volume.so`,
  `chart.It` and the domains `news.google.com`, `stock.twits`. Over-flag must be 0.

## Verification (standalone stub runner, not pytest)

The runner imports the test modules with a pytest stub, expands parametrize, and runs every test in the mirrors file
plus every `*guard*` test in `tests/test_uct_agent_knowledge.py` (fixture tests skipped).

* At `76f63d712a`: 43 passed, 6 failed (5 G1 rails plus #1030's limit bug) (standalone stub runner, not pytest).
* After the fix: **49 passed, 0 failed** (standalone stub runner, not pytest).
* After the AUDIT items (b, d below): **53 passed, 0 failed** (standalone stub runner, not pytest).
* After AUDIT round 3 (the stdout print and its capfd test): **54 passed, 0 failed** (standalone stub runner, not pytest).
* **False-positive check:** 0 of 34 controls flagged. The existing knowledge-guard precision lists still pass.
  Old guard vs new guard over all 816 string constants in `tests/test_uct_agent_knowledge*.py`: 0 newly passed.
  1 newly flagged: the bare literal `stock.profile`, an action name in a `step_result_text` test, never guarded.
* **Mutations**, each red (standalone stub runner, not pytest):
  * **M1**: the old hand-typed list restored. 3 fail: PLANTED 7/10 missed, registry 58 open, manifest ratchet 45.
  * **M2**: golden only, no registry scan. 3 fail: PLANTED 1/10 (`playbook.record`), registry 15 open, derived-families rail.
  * **M3**: no camelCase verbs. 4 fail: PLANTED 3/10, registry 24 open, manifest ratchet, new-family rail.
  * **M4**: camelCase test made case-insensitive. 1 fails: over-flag 5/34 controls.
  * With the AUDIT tests added, M1 also fails the per-family planted rail (13/32 families pass) and the fallback rail;
    M2 fails the per-family rail (fewer than 32 families); M3 fails it with 3/32 (`history`, `indicatorCopy`, `indicatorStyle`).
  * **M5**: boot log not once (the `_BOOT_LOGGED` check removed). 1 fails: fallback rail (second call logs again).
  * **M6**: `source_line()` always says `registry`. 1 fails: fallback rail.
  * **M7**: the no-registry clause fails OPEN (matches nothing). 1 fails: fallback rail (`chart.goToDate` passes).
  * **M8**: one family (`volume`) dropped from the clause. 3 fail: per-family planted (`volume`), registry rail, manifest ratchet.
  * **M9**: the `print(line, flush=True)` removed. 1 fails: the capfd stdout rail. (M5 now also fails it.)

CI/AUDIT runs pytest.

## AUDIT hard precondition

`docs/feature_flags.json` gains a new top-level section, `audit_preconditions.G1_knowledge_guard_bare_action_names`.
It is not a gate, so it is not in `flags`, and the readme says so. **No widening of UCT_AGENT_KNOWLEDGE, UCT_AGENT_DATA
or the knowledge kinds beyond admin until this fix is merged and the precondition is lifted by AUDIT after production
check.** Its status reads "lifted by AUDIT after production check" and `lifted_on` is `null`. A green rail does not
close it.

## AUDIT items on #1039 (round 2)

**b. Boot log line.** `guard.log_action_source_once()` logs `guard.source_line()` once per process through the guard's
existing module logger (`logging.getLogger("api.services.uct_agent.knowledge.guard")`, the same logger its
"unreadable" warnings use). It runs at server boot: `api/routers/uct_agent.py` calls it at import, and `api/main.py`
imports that router at module load (`from api.routers import uct_agent as uct_agent_router`). From the repo it reads
`[uct-agent] knowledge guard action source: registry (178 names, 32 families)` at INFO; a fallback source logs at
WARNING. A failure in the call is caught and logged, so it can never stop boot.
**It also prints the line to stdout, unconditionally, with `flush=True`** (AUDIT round 3), the way main.py prints its
`[startup]` fingerprint lines. At import time logging may not be configured, so an INFO record alone might never reach
Railway's log stream, and then a missing line could not tell "registry" from "never ran". The logger call stays for
both sources (INFO for registry, WARNING for fallback).
`test_the_boot_line_is_PRINTED_to_stdout_once(capfd)` resets `_BOOT_LOGGED`, calls the function on the real repo
module, and reads fd 1. **It proves** the registry line reaches file descriptor 1 exactly once on the first call, with
logging config playing no part, and that a second call writes nothing. **It does not prove** that a real uvicorn boot
runs it (the router-import rail is a source check, and fastapi isn't imported here), or what Railway keeps. The stub
runner gained an fd-level `capfd` shim (dup2 of fds 1 and 2 onto temp files) to run it.
**Log line only, no status field.** The only existing admin endpoint that reports server Agent state is
`GET /api/agent/config`, and it is the browser's contract (stream, nl1, data, planner, coach, routing_v2), not a
status or health endpoint. The knowledge health report (`knowledge/health.py`) is a reindex-time file, not an
endpoint. Neither fits, so nothing was added to them.
Rails: `test_the_action_source_is_REGISTRY_from_the_repo_root` (source == "registry", line format and counts);
`test_the_FALLBACK_path_reports_fallback_and_fails_closed` loads a copy of `guard.py` from a temp tree with no
`app/`, so the real fallback path runs: source "fallback", 0 names / 0 families, `chart.goToDate` still withheld,
and the line logged once (second call returns None); `test_the_server_boot_logs_the_action_source_once` (the router
calls it exactly once and main.py imports the router). Not verified by importing the router locally: this machine
has no fastapi.

**c. A bare `stock.profile` test argument never reaches the guard.** Every caller, from
`grep -rn -E "knowledge(\.| import )[^#]*guard|guard\.(check|suspicious|action_clause|action_source|action_families)" api`
(there is no `screen()`: the guard's entry points are `check()` and `suspicious()`; `coach/__init__.py:173`
`guard.check` is the separate coach guard, `api/services/uct_agent/coach/guard.py`):

```
data read (gateway Kind registry; knowledge/kinds.py register(): knowledge.search, setup.playbook)
 ├─ kinds.search(params, ctx)                      knowledge.search
 │    for r in index.query(...)                    retrieved brain-pack rows
 │      guard.suspicious(r["content"])             kinds.py:236  the whole passage
 │      guard.check(_focus(r["content"]...))       kinds.py:239  the shown excerpt
 │      guard.check(r["title"])                    kinds.py:240
 │      guard.check(policy.trader(r["trader"]))    kinds.py:247
 └─ kinds.playbook(params, ctx)                    setup.playbook
      _clean_value(template field)                 kinds.py:463/467/474 -> guard.check   kinds.py:436
api/routers/uct_agent.py                           guard.log_action_source_once()  (boot; no text)
```

`setup.record` does not call the guard. Every string the guard screens is retrieved content (a KB passage, its title,
its trader label, or a stored setup-template field). None of them is a capability name, a tool argument, or a step
result. The test that carries the literal, `tests/test_uct_agent_knowledge.py:766`, calls
`turn_v2.step_result_text({"name": "stock.profile"}, ...)`. `turn_v2.py` does not import the knowledge guard, and
`step_result_text` formats an executed step's name and result for the model. So the one newly-flagged literal from
the 816-string sweep never meets the guard in production.

**d. One planted post per family, all 32.** `test_PLANTED_one_quoted_post_per_FAMILY_is_WITHHELD` takes the first
name of each family from the guard's own registry-derived list, puts it mid-sentence in one of 4 quoted-post shapes,
and requires every one withheld. It also requires the planted families to equal `action_families()` (at least 32), so a
family the registry gains is planted automatically. No family is exempt: KB text can quote any dotted name, so all 32
can occur.

**e.** See "AUDIT hard precondition" above (`docs/feature_flags.json`).

**f.** File counts below are git's own.

## Known separate item (not fixed here): G2

`turn_v2.domain_for` falls through to `"history"` for any prefix missing from `_DOMAIN_OF`. `calendar.*` is in that
gap (frozen in #1030's `DOMAIN_KNOWN_UNLISTED = {"calendar"}`), so planner v2 tells the model that `calendar.day` /
`calendar.nextReport` live under market-breadth history. A silent misfile, not a refusal. It needs its own
branch: decide the right domain, add `_DOMAIN_OF["calendar"]`, and shrink that freeze to empty.

## Files (git-derived)

**5 files vs `5f5bdcd7e6` (#1030's head), including this doc.** `git diff --name-status 5f5bdcd7e6 HEAD`:

```
M	api/routers/uct_agent.py
M	api/services/uct_agent/knowledge/guard.py
A	docs/agent/program/PR-knowledge-guard-bare-names.md
M	docs/feature_flags.json
M	tests/test_uct_agent_server_capability_mirrors.py
```

Line counts for the 4 non-doc files (`git diff --stat 5f5bdcd7e6 HEAD`, this doc left out because its own count
changes as it is committed):

```
 api/routers/uct_agent.py                          |   8 +
 api/services/uct_agent/knowledge/guard.py         | 102 +++++++++-
 docs/feature_flags.json                           |  20 +-
 tests/test_uct_agent_server_capability_mirrors.py | 215 ++++++++++++++++++++--
 4 files changed, 328 insertions(+), 17 deletions(-)
```

The round-1 doc said 3 files there; that left the doc out. With the doc it was 4; the boot-log call in
`api/routers/uct_agent.py` makes it 5.

`git diff --stat origin/master...HEAD` (merge-base `292983f4bc`; includes all of #1030; this doc left out):

```
 api/routers/uct_agent.py                           |   8 +
 api/services/uct_agent/knowledge/guard.py          | 102 ++++-
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
 docs/feature_flags.json                            |  20 +-
 tests/fixtures/nl1_assemble_parity.json            |  33 +-
 tests/test_uct_agent_contract.py                   |   4 +-
 tests/test_uct_agent_server_capability_mirrors.py  | 289 +++++++++++++
 26 files changed, 2368 insertions(+), 144 deletions(-)
```

Plus this doc. No JS product code changed, so the
no-lookbehind rule doesn't apply. The guard is Python.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Dhm4qhJhGoto7iixuJEEzM
