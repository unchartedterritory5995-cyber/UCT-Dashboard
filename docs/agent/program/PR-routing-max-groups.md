# PR: routing — server MAX_GROUPS 24 → 32, with a rail

Branch `agent/pl/routing-max-groups`, on master `64421f770d`. Server-side, one constant plus one JS rail. Lands BEFORE #1074 (Layout Dock bar actions), which adds a routing group, and before any other family that adds one (#1030 may).

## Cause

`api/services/uct_agent/turn.py` `validate_routing` keeps only the first `MAX_GROUPS` (24) of the browser's routing groups. Groups past that are dropped **silently** from the model's "other action groups" list and from the `need_groups` enum, so a request that needs one of them can never reroute to it. Master sends exactly 24 groups on the charts surface (NL-1 parity fixture: every routed case has 24). #1074 adds a 25th (`layoutBar`), and that pushed the last one (`guide`) off. Only `tests/test_uct_agent_nl1_selection.py::test_a_routed_nl1_request_is_three_cache_blocks_core_first` noticed, and only indirectly.

routing.js `GROUPS` has 26 entries on master. Two are empty in the charts ctx (for example `coach`, which is dark on a server without its kind). With every kind on, master can already send more than 24.

## Fix

- `MAX_GROUPS = 32`. The constant bounds an untrusted browser payload (each title is cut to 160 chars), so 32 keeps it bounded. `_GROUP_ID` is unchanged.
- Rail `app/src/agent/routingMaxGroups.test.js`: reads `MAX_GROUPS = <n>` from turn.py's text (a regex with no lookbehind) and asserts `GROUPS.length <= MAX_GROUPS`. It checks every declared group, an upper bound on any request's list. The failure message: "routing has N groups but the server keeps only MAX_GROUPS = M; raise it in turn.py".

## Evidence (LOCAL)

- Mutant: 7 dummy groups were prepended to `GROUPS` (33 groups), and the rail went red with "routing has 33 groups but the server keeps only MAX_GROUPS = 32; raise it in turn.py". routing.js was restored from git afterwards. With the real GROUPS (26), the rail passes.
- Rail + the 4 count pins (agentRouting, agentScreener, agentNl1Selection, agentIndicatorsM2) + noRegexLookbehind: 6 files, 84 tests passed.
- Full `tests/test_uct_agent*.py`: 4122 passed, 1 failed: `test_r751_mentions_mode_only_serve_flagged_re_admits`, the known flake; it passes when re-run alone (1 passed).
