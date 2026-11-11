# PR: routing — server MAX_GROUPS 24 → 32, a once-per-process warning on a cut, and a rail

Branch `agent/pl/routing-max-groups`, on master `64421f770d`. Server-side: one constant, one warning, one pytest and one JS rail. Lands BEFORE #1074 (Layout Dock bar actions), which adds a routing group, and before any other family that adds one (#1030 may).

## What MAX_GROUPS bounds

`validate_routing`'s `{id, title}` list, taken from the browser's untrusted `routing.groups` (each title is cut to 160 chars). It feeds two things:
- the **"OTHER ACTION GROUPS" lines**: the groups that exist but were not given (`_routing_note`);
- the **`need_groups` enum** of the output schema.

Where it lands: the routing note is in the request's **last** system block (`nl1_system_texts`' second text, or `system_parts`' second part). That block has `cache_control` like every block, but it is the per-request part after the cached core + reference data, so it is not part of the stable cached prefix.

It never bounds actions. The bound on actions stays the browser's action budget (NL-1: 55, `nl1/selection.js`) and the server's `MAX_CAPABILITIES`.

## Cause

`validate_routing` kept only the first 24 groups and dropped the rest **silently**, the same class of defect as #1078's args-schema drop. A dropped group can never be offered to the model or asked for in `need_groups`.

Master sends exactly 24 groups on the charts surface (NL-1 parity fixture: every routed case has 24). #1074 adds a 25th (`layoutBar`), and that pushed the last one (`guide`) off. Only `tests/test_uct_agent_nl1_selection.py::test_a_routed_nl1_request_is_three_cache_blocks_core_first` noticed, and only indirectly.

routing.js `GROUPS` has 26 entries on master. Two are empty in the charts ctx (for example `coach`, which is dark on a server without its kind). With every kind on, master can already send more than 24.

## Fix

- `MAX_GROUPS = 32`. It stays bounded: at most 32 × 160 chars of titles. `_GROUP_ID` is unchanged.
- **Never silent**: when `routing.groups` is over the limit, it is still cut (behaviour unchanged). The first time this happens in a process, the server logs ONE `WARNING` naming the dropped ids: `[uct-agent] routing sent N groups; the server keeps only MAX_GROUPS=M, dropped: …`. It does not repeat on every turn. Covered by `tests/test_uct_agent_routing_max_groups.py` (caplog), which checks the cut, the ids in the message, exactly one record over three over-limit calls, and no log within the limit.
- **Rail** `app/src/agent/routingMaxGroups.test.js`: reads `MAX_GROUPS = <n>` from turn.py's text (regex, no lookbehind) and asserts routing.js `GROUPS.length <= MAX_GROUPS`. That counts every declared group, an upper bound on any request's list. Failure message: "routing has N groups but the server keeps only MAX_GROUPS = M; raise it in turn.py".

## Prompt-size delta, 24 → 32 groups (offline, deterministic, no model)

Measured with `turn._routing_note(…, nl1=True)` and the `need_groups` enum on the NL-1 parity fixture's routed core + `layouts` case: 24 real groups, 5 selected, titles at their real lengths after the 160 cut. For 32, the 8 extra groups are synthetic, because only 26 exist. "Tokens" ≈ bytes / 4.

| groups sent | unselected | routing note | need_groups enum |
|---|---:|---:|---:|
| 24 (real) | 19 | 3185 B (~796 tok) | 246 B |
| 32, 8 more at the mean real title length (140) | 27 | 4393 B (~1098 tok) | 326 B |
| 32, 8 more at the 160-char cap | 27 | 4553 B (~1138 tok) | 326 B |

So filling all 8 new slots costs at most about +1.4 KB (~+340 tokens) in the per-request block, plus +80 B of enum. Raising the cap costs nothing by itself: the bytes grow only as real groups are added (for example, #1074's one group adds one line).

## Evidence (LOCAL)

- **Mutant A** (rail): 7 dummy groups prepended to `GROUPS` (33) with the limit at 32. The rail went red: "routing has 33 groups but the server keeps only MAX_GROUPS = 32; raise it in turn.py".
- **Mutant B** (limit back to 24): the rail went red ("routing has 26 groups but the server keeps only MAX_GROUPS = 24; raise it in turn.py"). The real 24 parity groups + `layoutBar` (25) sent twice through `validate_routing` logged exactly one line, `WARNING api.services.uct_agent.turn [uct-agent] routing sent 25 groups; the server keeps only MAX_GROUPS=24, dropped: guide`, and `guide` was not offered. Both mutants were restored, and the rail passes at 32 with the real 26 groups.
- Rail + the 4 count pins (agentRouting, agentScreener, agentNl1Selection, agentIndicatorsM2) + noRegexLookbehind: 6 files, 84 tests passed.
- Full `tests/test_uct_agent*.py`: 4124 passed, 1 failed: `test_r751_mentions_mode_only_serve_flagged_re_admits`, the known flake; it passes when re-run alone.
