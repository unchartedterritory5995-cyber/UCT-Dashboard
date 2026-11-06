NEXT STEP (heavy, HELD until the coordinator says go): re-run `runs/w6-t1/mp.sh` (measure-pair runtime 0 then 1, census on, tip pine-dsk-w6t1 vs base pine-dsk-mpbase3 @ 2f40ee68c5) under the SHARED lock `_resume-2026-11-01/dsk/heavy-mp3.lock`, after ram_gate. Skip runtime 0 if the orphaned run in runs/w6-t1/mp0 completed (see 'Measure-pair status'). Then: classify the diffs, merge origin/master, run a FULL final-tip (`final-tip.sh pine-dsk-w6t1 w6-t1-final tests/test_pine_coverage_w6_t1_relabel.py` under LOCK_FINAL2), push, and run `ready-check.sh` on runs/w6-t1-final.

# W6-T1 evidence: re-wave the mis-labelled W6 guards (tooling only)

Branch `feat/pine-w6-t1-relabel`. Spec: `docs/pine/W6-BREAKDOWN.md` section 4 T1, with section 3 and
section 0 finding 3 (branch `origin/docs/pine-w6-breakdown` @ `1889bbedd7`).
Code commit `4d8d6f3534`; tested-on-master `2f40ee68c5` (= merge-base; W6-T2 engine 19 and W3W4-T0 are in it).

## What T1 still had to do after W6-T2 and W3W4-T0

- W6-T2 (engine 19) fixed the two **engine** misreads (`technical-ratings`' `timeframe.period`, the v3
  `method =` binding). They are not tooling, so T1 does not touch them. The census these maps read is
  W3W4-T0's (`runs/w34-t0`, master `3ca4b0d358`, before T2), so both rows still carry their old walls there.
- W3W4-T0's census honesty is about drawing objects. W9-T0 made an order strategy a W9 member at the
  **script** level. Neither one tagged a `pine:collection`, `pine:type` or `pine:member` wall.
- So T1 was **not** already covered: `runtimeWaves.W6.blocks` was 57 on the same census rows (below).

## What changed (tooling only, no `app/src` file, no wall label)

`tools/pine_coverage/coverage_map.py`: `runtime_wall_steps(row, src)` tags four W6-labelled walls. It reads
the step's own detail together with the script's unpeeled source (comments and strings are stripped
first). `runtime_on_section` now passes each script's source. `tools/pine_coverage/w0/targets.py::rt_wave`
re-waves a wall by its tag.

| tag | wall | rule | wave |
|---|---|---|---|
| `ltf-array` | `pine:collection` | detail "`x` is read as an array here and nothing in this script creates it", and `x` is bound by `request.security_lower_tf(…)` in the unpeeled source (tuple or single binding, multi-line) | W7 |
| `tuple` | `pine:collection` | the step text is a bare bracket list `[a, …]`. Pine has no array literal, so it is a tuple value | W4 |
| `library` | `pine:type` / `pine:member` | the head is an `import` alias (explicit `as`, or the library's default name), or is declared with `alias.Type`, or is bound from `alias.…` | W8 |
| `footprint` | `pine:type` / `pine:member` | the head is declared `footprint` / `volume_row` or bound by `request.footprint(…)` | W7 |

### Two deviations from the spec, both made so that the labels tell the truth

1. **`inside-bar-strategy-w-sl` is a tuple, not an order wall.** Section 7 left this open. The source
   answers it (read locally, not quoted beyond this): a user function's `if` arms end in `[inside1Bar]` …
   `[na]`, and the caller destructures `[insideBar] = InsideBar(i_NBars)`. That is a one-element tuple
   value. The spec's rule (order strategy → W9) would re-wave **any** `pine:collection` on a strategy,
   even a real collection, and it would leave the same tuple on an indicator as W6. So T1 tags the shape
   (`tuple`) and sends it to W4 (statement and block-value forms, beside `runtime:block-value`). The
   script stays a W9 member through W9-T0's script-level rule, so its W9 membership is unchanged.
2. **`lorentzian-classification-advanced-trading-dashboard`'s `pocRow` is not a library type.** It is
   `volume_row pocRow = reqFP.poc()` with `footprint reqFP = request.footprint(…)`, the v6 built-in
   footprint types, so it is tagged `footprint` and sent to W7 (request.*). The script's two libraries
   (`msl`, `vis1`) are not involved in this wall.

### Why `tuple` goes to W4 (for the reviewer to check)

Source: `corpus/committed/inside-bar-strategy-w-sl__b39f395d5d.pine` (MPL-2.0, committed corpus). It is
`//@version=4` (line 23) and `strategy(` (line 24).
- Line 98: `InsideBar(NBars) =>` is a user function. Its body is one `if / else if … / else` statement.
- Lines 105, 108, 111 and 114: each arm's last line is `[inside1Bar]` … `[inside4Bar]`. Line 116: `else` ends in `[na]`.
- Line 117: `[insideBar] = InsideBar(i_NBars)` is the call site, which destructures a one-element tuple.
- The five `pine:collection` census steps are on exactly lines 105, 108, 111, 114 and 116, each with token
  `[` and step text `[insideNBar]` / `[na]` (`runs/w34-t0/rt/census.jsonl`, `rtProbe.line` / `.text`).
- Pine has no array literal: arrays come only from `array.*` constructors. So a bracket list in value
  position is a tuple, here the value of the function's last `if` arm. What is missing is a tuple-valued
  `if` arm in a function body, which is a statement and block-value form. `runtime:block-value` is
  W4 (`rt_wave`'s default), so that is where the tag sends it. Nothing in the wall involves orders.
- Why not the spec's "order strategy → W9": that rule keys on a coincidence. It would also re-wave a real
  collection wall on any order strategy, and it would leave this same tuple shape as W6 on an indicator.
  The script is still a W9 member through W9-T0's script-level rule (`if order_strategy: wv.add("W9")` in
  targets.py), so its W9 membership does not change. It leaves W6 and joins W4.
- Rails: `test_a_bare_bracket_list_is_a_tuple_value_w4_and_not_a_collection` (W4 even when
  `order_strategy=True`) and `test_an_indexed_or_called_bracket_is_not_a_tuple` (`x = arr[0]`,
  `[a, b] = f(x)`, `[a[1]]` stay W6).

`footprint-strategy`'s `previos_detail_close.size()` stays W6 (T9). The head is a history read of an
LTF array, so knowing the receiver's type is the missing piece, and the detail is not the orphan one.

## Rails: `tests/test_pine_coverage_w6_t1_relabel.py` (13 tests, fixtures written for the rail)

- On master's tooling: **12 failed, 1 passed** (`runs/w6-t1/rails-master.log`). The one that passes is
  `test_untagged_w6_guards_are_still_w6`, a control that is true on both. On the tip: **13 passed**.
  Red on master: every ltf-array, tuple, library and footprint test; the source controls; and the
  `runtime_on_section` end-to-end test.
- Neighbouring rails stay green on the tip: `test_pine_coverage_w4_t0_honesty.py`,
  `test_pine_coverage_w3w4_t0_honesty.py` and `test_pine_coverage_w9_t0_strategies.py` (57 passed with the
  new file).

## Mutations: `docs/pine/parity-programme/scripts/mutate.py`

Command: `mutate.py muts.json tests/test_pine_coverage_w6_t1_relabel.py`, run through a pytest shim
(`runs/w6-t1/mutshim`). The shim gives each run a fresh `PYTHONPYCACHEPREFIX`, so a stale `.pyc` cannot
hide a same-length mutation. Restores are mutate.py's byte-exact ones; the tree was clean afterwards.
Tip `4d8d6f3534`. Log: `runs/w6-t1/mut.log`. **Control survived; 20 of 20 killed.**

| # | mutation | result, killed by |
|---|---|---|
| M00 | no-op control (comment) | SURVIVED (control) |
| M01 | drop the `ltf-array` tag (spec mutation) | KILLED `…lower_timeframe_tuple_is_w7` |
| M02 | ltf-array without the source check | KILLED `…not_bound_by_security_lower_tf_stays_w6` |
| M03 | source facts keep comments and strings | KILLED same |
| M04 | a tuple binding names only its bracket | KILLED `…lower_timeframe_tuple_is_w7` |
| M05 | ltf-array without the orphan detail | KILLED `…without_the_orphan_detail_stays_w6` |
| M06 | tuple = any text starting with `[` | KILLED `…indexed_or_called_bracket_is_not_a_tuple` |
| M07 | drop the `tuple` tag | KILLED `…bare_bracket_list_is_a_tuple_value_w4…` |
| M08 | import alias only when spelled `as` | KILLED `…value_a_library_built_is_w8` |
| M09 | library: no rhs alias check | KILLED same |
| M10 | library: no declared-type check | KILLED same |
| M11 | library: every head | KILLED `…local_collection…stays_w6` |
| M12 | member head not read off the chain | KILLED `…import_alias_chain_is_w8` |
| M13 | footprint: `volume_row` dropped | KILLED `…footprint_value_is_w7` |
| M14 | footprint: `request.footprint` rhs dropped | KILLED same |
| M15 | map section does not pass the source | KILLED `…runtime_on_section_reads_each_scripts_own_source` |
| M16 | `rt_wave`: ltf-array stays W6 (spec mutation) | KILLED `…lower_timeframe_tuple_is_w7` |
| M17 | `rt_wave`: tuple stays W6 | KILLED `…tuple_value_w4…` |
| M18 | `rt_wave`: library stays W6 | KILLED `…import_alias_chain_is_w8` |
| M19 | `rt_wave`: footprint stays W6 | KILLED `…footprint_value_is_w7` |
| M20 | `rt_wave`: any tag moves any wall | KILLED `…untagged_w6_guards_are_still_w6` |

## Census effect: the same census rows, master's tools vs the tip's tools

Script: `runs/w6-t1/maps.sh`. It runs both tools over W3W4-T0's census caches (`runs/w34-t0`, prod plus
runtime-on, 679 scripts). No census was re-run.
- `coverage-map.json`: **identical except `runtimeOn.walls.tags`**, where 7 scripts gain a tag:
  - `ltf-array`: `delta-volume-candles-lucf`, `volume-delta-oi-delta-kioseff-trading`,
    `volume-suite-by-leviathan`, `strong-knn-classifier`;
  - `tuple`: `inside-bar-strategy-w-sl`;
  - `library` (both walls): `trailing-take-profit-trailing-stop-loss`;
  - `footprint`: `lorentzian-classification-advanced-trading-dashboard`.
- Targets: only `runtimeWaves` and `waveGreedy` differ. **W6 blocks 57 → 50**: those 7 scripts leave W6.
  W4 goes 213 → 214 (+`inside-bar-strategy-w-sl`). W7, W8 and W9 are unchanged, because those scripts
  were already members through other walls. In the runtime-on greedy, W6 unblocks 56 → 49 and W7
  unblocks 64 → 67.
- `runtimeWallWave["pine:collection"]` stays `W6`. Its scripts now map to two waves (W7 and W4), and
  `wall_wave` keeps the label's wave when they disagree. That is the existing rule, unchanged.
- The spec forecast "56 → about 50"; the result is 57 → 50.

## Measure-pair status

The first attempt (`runs/w6-t1/mp.sh`) took heavy-mp3.lock at 09:45. Claude Code then stopped its wrapper
shell and the heavy-lock holder under memory pressure. The `measure-pair.sh` children kept running
orphaned. That has two consequences:
- the lock file's heartbeat went stale while they ran;
- the runtime-1 pass will not start.

Runtime 0, tip side, was complete (`runs/w6-t1/mp0`): audit, probe, census (967 rows) and harness all rc=0;
harness TOTAL 336, MATCH 93, DIVERGE 103, INCONCLUSIVE 140. The script flagged `BASE_HEAD MOVED on tip`
(`983cfed110` → `69ce7380fa`). That change is docs only (this file): both commits carry code commit
`4d8d6f3534`'s tree for every non-docs path. The base side was still running at the time of writing.
