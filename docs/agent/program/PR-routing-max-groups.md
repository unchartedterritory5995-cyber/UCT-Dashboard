# PR: routing — server MAX_GROUPS 24 → 48, a once-per-process warning on a cut, and a rail

Branch `agent/pl/routing-max-groups` (#1089), with master `7a2c1fae47` merged in. Server-side: one constant, one warning, one pytest and one JS rail. It lands BEFORE #1074 (Layout Dock bar actions) and before every other family PR that adds a routing group.

## What MAX_GROUPS bounds

`validate_routing`'s `{id, title}` list, taken from the browser's untrusted `routing.groups` (each title is cut to 160 chars). It feeds two things:
- the **"OTHER ACTION GROUPS" lines**: the groups that exist but were not given (`_routing_note`);
- the **`need_groups` enum** of the output schema.

Where it lands: the routing note is in the request's **last** system block (`nl1_system_texts`' second text, or `system_parts`' second part). That block has `cache_control` like every block, but it is the **per-request block** after the cached core + reference data. It is **not part of the cached prefix**.

It never bounds actions. Actions stay bounded by the browser's **55-action NL-1 budget** (`nl1/selection.js`) and the server's `MAX_CAPABILITIES`.

## Cause

`validate_routing` kept only the first 24 groups and dropped the rest **silently**, the same class of defect as #1078's args-schema drop. A dropped group can never be offered to the model or asked for in `need_groups`.

Master sent exactly 24 groups on the charts surface (NL-1 parity fixture: every routed case has 24). #1074 adds a 25th (`layoutBar`), and that pushed the last one (`guide`) off. Only `tests/test_uct_agent_nl1_selection.py::test_a_routed_nl1_request_is_three_cache_blocks_core_first` noticed, and only indirectly.

## Why 48

Master's routing.js declares 26 groups; two are empty in the charts ctx (for example `coach` while dark). The queued PRs add `layoutBar`, `multiChart`, `drawingOps`, `drawingBoards` and `periodSort` (31). Family builds in flight add `chartView` and `chartMenu` (33). So 32 was already too small. 48 leaves room for about 15 more families and stays bounded (48 × 160 chars of titles at most).

## Fix

- `MAX_GROUPS = 48`. `_GROUP_ID` is unchanged.
- **Never silent**: when `routing.groups` is over the limit, it is still cut (behaviour unchanged). The first time this happens in a process, the server logs ONE `WARNING` naming the dropped ids: `[uct-agent] routing sent N groups; the server keeps only MAX_GROUPS=M, dropped: …`. Covered by `tests/test_uct_agent_routing_max_groups.py` (caplog), which checks the cut, the ids in the message, exactly one record over three over-limit calls, and no log within the limit.
- **Rail** `app/src/agent/routingMaxGroups.test.js`: reads `MAX_GROUPS = <n>` from turn.py's text (regex, no lookbehind) and asserts routing.js `GROUPS.length <= MAX_GROUPS`. That counts every declared group, an upper bound on any request's list. Failure message: "routing has N groups but the server keeps only MAX_GROUPS = M; raise it in turn.py" (it names no fixed number).

## Per-turn size (offline, deterministic, no model)

Method: `turn._routing_note(…, nl1=True)` plus the `need_groups` enum, through `validate_routing`, on the NL-1 parity fixture's routed core + `layouts` case (5 groups selected). Titles are at their real lengths after the 160 cut:
- 26: master's routing.js GROUPS.
- 31: plus the 5 queued groups, with titles from their branches: `layoutBar` from agent/pl/layout-dock-exec `ab4f818011` (the re-merge, local); `multiChart`, `drawingOps`, `drawingBoards` and `periodSort` from origin/agent/pl/exec-multichart-grid, drawing-ops-exec, drawing-boards-exec and period-sort-exec.
- 33: `chartView` and `chartMenu` are not on any branch yet, so they are measured at the **mean** cut title length of the 31 real groups (115 chars).
- 48: the remaining slots are synthetic, at the mean (115) and at the 160 cap.

"Tokens" ≈ bytes / 4. "Total" = routing note + enum. Unselected = groups sent − 5 selected.

| groups sent | unselected | routing note | need_groups enum | total per routed turn |
|---|---:|---:|---:|---:|
| 24 (old cap) | 19 | 3185 B (~796 tok) | 246 B | 3431 B (~858 tok) |
| **26** (master today) | 21 | 3498 B (~874 tok) | 267 B | 3765 B (~941 tok) |
| **31** (+ 5 queued) | 26 | 4123 B (~1031 tok) | 339 B | 4462 B (~1116 tok) |
| 32 (31 + 1 at mean) | 27 | 4247 B (~1062 tok) | 347 B | 4594 B (~1148 tok) |
| **33** (+ chartView, chartMenu at mean) | 28 | 4371 B (~1093 tok) | 355 B | 4726 B (~1182 tok) |
| **48** (33 + 15 at mean) | 43 | 6231 B (~1558 tok) | 475 B | 6706 B (~1676 tok) |
| **48** (33 + 15 at the 160 cap) | 43 | 6906 B (~1726 tok) | 475 B | 7381 B (~1845 tok) |

| total | vs 24 | vs 32 |
|---|---:|---:|
| 26 | +334 B (~+84 tok) | −829 B (~−207 tok) |
| 31 | +1031 B (~+258 tok) | −132 B (~−33 tok) |
| 33 | +1295 B (~+324 tok) | +132 B (~+33 tok) |
| 48, at mean | +3275 B (~+819 tok) | +2112 B (~+528 tok) |
| 48, at the 160 cap | +3950 B (~+988 tok) | +2787 B (~+697 tok) |

**Per group**: about 132 B (~33 tokens) per routed turn at the mean title length, and up to ~45 tokens at the 160-char cap (title line + enum entry). Raising the cap costs nothing by itself; the bytes grow only as real groups are added. All of it is in the per-request block, not the cached prefix.

## Design note: words-only groups ride every request

Every new family adds a words-only group (`watchlistShow`, `compareGroups`, `layoutBar`, …). Every group, selected or not, is listed in "OTHER ACTION GROUPS" (and in the `need_groups` enum) on **every** routed turn. So the per-request overhead grows by one group, about 33 tokens (~45 at most), with each family, even on turns that have nothing to do with it.

**Proposed follow-up (its own PR, not this one):** list a words-only group only when it is selected, or when its words appear in the message. The trade-off: the model can no longer ask for an unlisted words-only group through `need_groups`, so reaching that group would rely on its own words and on the reroute. This follow-up is planned and will be measured before it ships: per-turn bytes and tokens, plus first-call / reroute coverage on the standard sets.

## Evidence (LOCAL)

- **Mutant A** (rail, earlier head at 32): 7 dummy groups prepended to `GROUPS` (33). The rail went red: "routing has 33 groups but the server keeps only MAX_GROUPS = 32; raise it in turn.py".
- **Mutant B** (limit back to 24, re-run at this head):
  - The rail went red: "routing has 26 groups but the server keeps only MAX_GROUPS = 24; raise it in turn.py".
  - The real 24 parity groups + `layoutBar` (25), sent twice through `validate_routing`, logged exactly one line: `WARNING api.services.uct_agent.turn [uct-agent] routing sent 25 groups; the server keeps only MAX_GROUPS=24, dropped: guide`. `guide` was not offered.
  - Restored to 48.
- Rail + the 4 count pins (agentRouting, agentScreener, agentNl1Selection, agentIndicatorsM2) + noRegexLookbehind: 6 files, 84 tests passed.
- Full `tests/test_uct_agent*.py`: 4130 passed, 0 failed.
