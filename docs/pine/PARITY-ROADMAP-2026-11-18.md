# Pine parity roadmap, 2026-11-18 (engine 73, measured)

The owner's direction (2026-11-18): the platform must be able to do everything TradingView's Pine
can. This page orders all engine work from here by what it unlocks for members, measured on the
coverage-map sample at engine 73. Machine twin: [`parity-roadmap.json`](parity-roadmap.json), written by
`tools/pine_coverage/parity_roadmap.py` from the regenerated [`coverage-map.json`](coverage-map.json)
and held to it by `tests/test_pine_parity_roadmap.py`. Previous measurement:
[`COVERAGE-MAP-2026-11-17.md`](COVERAGE-MAP-2026-11-17.md) (engine 71), whose definitions and lanes
this page keeps.

> **Members are served 275 of 679 sample scripts (40.5%) at engine 73,
> exactly the 11-17 figure (275).** That is the runtime-on lane, which production runs armed, with the
> server's capability admission applied: 220 transfer fully on the host lane, and
> 55 of the 65 the runtime lane alone draws are admitted (1 graded
> allowlist, 54 by capability; 10 declined `runtime:not-yet-graded`).
> **Runtime-on lane, census grants every script: 285 (42.0%)** (285 on 11-17).
> **Host-only baseline: 220 (32.4%)** (220 on 11-17).
> Engines 72 and 73 moved no script in or out of either lane: the same 220 host and 285 runtime-on scripts,
> one wall relabelled. Route-by-cost (#1711) moved host-clean scripts onto the runtime lane in the granted
> census (runtime-attached 70 -> 88); they stay served in production either way.
> **404 scripts are not served.** 9 of them need data no engine work can supply
> (section 6). The rest are measured walls: one engine unit per wall family (section 5), ranked by
> scripts unlocked per unit of work (section 7). Built in that order, engine and evidence work frees
> 321 more scripts, reaching 596 of 679 (87.8%) served. That is an upper bound: 161 of the
> 321 have their whole wall list enumerated. The strategy broker, an owner decision, holds
> 70 more, and data decisions (breadth, index series, corporate events) 4.

These are door verdicts on one daily chart (NYSE:RDDT 1D), not parity verdicts; parity is graded where
a capture exists (each unit's evidence column). Two walls the 1D census cannot see are added from
other measurements (section 4.4).

## 1. What "served" and "wall" mean here

- **Served (member-facing).** Production runs the runtime pane armed with capability admission on
  (`PINE_RUNTIME_STAGE=all`, `PINE_RUNTIME_CAPABILITY_ADMISSION=on`, read from Railway by the coordinator
  on 2026-11-17 and recorded in the 11-17 map). A sample script is served when:
  - it transfers fully on the host lane (`coverage_map.transfers_fully`: the census's `isClean`, the host
    known-divergence list applied), or
  - the runtime-on lane draws it (`runtime_on_transfers`, the runtime kill list applied) AND the server
    admits it: on the graded allowlist (`runtime_definitions.graded_allow_list`), or every capability
    `pine_capabilities.capabilities_of` names is admitted by the committed registry
    (`admitted_capabilities()`). The census grants every script, so this is applied statically, exactly
    as the 11-17 map's section 1 did (reproduced: the e71 census through this tool gives 275, the 11-17
    figure).
  - An order-placing strategy is never served (the broker is not armed for members).
- **Wall.** For a script that is not served, its walls are labels the census already prints:
  - the runtime lane's own walls over every peel step (`runtimeOn.walls.byScript`);
  - if it has none and the host lane attached it dirty (so the runtime lane was never offered it), the
    host object program's walls (`runtimeOn.walls.attachedDirtyWalls`);
  - `[strategy]` for an order-placing strategy (its "nothing to plot" folds into it, as the census
    relabels it); `[known-divergence]` / `runtime:kill-list` for a script a list refuses by name;
  - `admission:<capability>` for every capability the server does not admit, on every script whose
    route is the runtime lane. Admission is evidence work, not engine work, and still a wall: a script
    freed of its last runtime wall is not served until its capabilities are admitted.
- **Sole / any / pair.** Sole: the script's only wall. Any: one of its walls. Pair: exactly two walls.
  A peel that did not reach a build (`reachedAfterPeel` false) may hide walls behind the ones it named,
  so every sole count is stated with its fully enumerated part, which is firm.
- **Units.** Every wall maps to one engineering unit (`parity_roadmap.UNITS`; a capability with no engine
  unit is its own evidence unit `admit:<capability>`). The rail fails if a wall maps to none.

## 2. The headline at engine 73, against 11-17

| | 2026-11-17 (`1df860c1e8`, e71) | 2026-11-18 (`99de72e7c0`, e73) |
|---|---:|---:|
| **member-facing: runtime-on lane with the server's admission applied** | **275 (40.5%)** | **275 (40.5%)** |
| runtime-on lane, the census granting every script | 285 (42.0%) | 285 (42.0%) |
| host-only baseline (`headline.transfer`) | 220 (32.4%) | 220 (32.4%) |
| runtime-on: added over host-only / lost | 65 / 0 | 65 / 0 |
| of the added: graded allowlist / capability-admitted / declined | 1 / 54 / 10 | 1 / 54 / 10 |
| capabilities that declined them | `obj:linefill` 4, `collections:matrix` 2, one each of `request-other`, `varip`, `method-def`, `calc-bars` | `obj:linefill` 4, `collections:matrix` 2, `calc-bars` 1, `method-def` 1, `request-other` 1, `varip` 1 |
| of the served, admitted for closed-bar history only (`realtime-state`) | 11 | 11 |
| runtime-attached at step 0 (granted census) | 70 | 88 |
| not served | 404 | 404 |
| of them, wall list fully enumerated | (not computed) | 201 |
| strategies that would transfer if the broker were armed | 7 of 70 | 7 of 70 |

The 11-17 column re-reads the 11-17 census rows through this tool: its static admission check gives 275,
the 11-17 map's figure, so the rule is reproduced, not restated. The e71 and e73 served sets are the same
275 scripts. The one per-script change is a relabel: `committed:mgi-levels-suite` reads `pine:arity` where
it read `pine:function` (#1713 maps two session names). Parity at engine 73 (the committed captures, 837 graded): production DIVERGE 74, INCONCLUSIVE 575, MATCH 188; runtime-on DIVERGE 67, INCONCLUSIVE 465, MATCH 285, MATCH_SUBSTITUTED 20. Production verdicts are identical
capture for capture; the 32 runtime-on moves since 11-17 are all strategies (section 9). The engine-door
probe declares 94 engine functions, 89 on 11-17: the 5 session readers #1713 added, each reachable.

## 3. The host-only lane's blockers (comparable with 11-17)

The list every map has ranked (`blockers`): the walls of the host lane alone. The coordinator's 11-17
figures (sole: imperative 40, strategy 37, request-security 15, imports-libraries 11, user-functions 9,
compute-budget 9) are unchanged at engine 73. Rows with no sole script and fewer than 8 scripts are left
out here; the JSON holds all 252, with each one's sole scripts.

| blocker | capability | sole | any |
|---|---|---:|---:|
| `[imperative]` | imperative | 40 | 174 |
| `[strategy]` | strategy | 37 | 70 |
| `[request-security]` | request-security | 15 | 52 |
| `[imports-libraries]` | imports-libraries | 11 | 61 |
| `[user-functions]` | user-functions | 9 | 63 |
| `[compute-budget]` | compute-budget | 9 | 11 |
| `[translator-robustness]` | translator-robustness | 5 | 24 |
| `[output-contract]` | output-contract | 5 | 7 |
| `[history-offsets]` | history-offsets | 4 | 23 |
| `[udt-methods]` | udt-methods | 3 | 20 |
| `[drawing-objects]` | drawing-objects | 3 | 8 |
| `object op dropped: update:props` | drawing-objects | 2 | 31 |
| `[paint-withheld]` | paint-withheld | 2 | 18 |
| `array.get` | collections | 2 | 9 |
| `[text-colour-values]` | text-colour-values | 2 | 8 |
| `ta.sar` | builtin-missing | 2 | 3 |
| `object op dropped: guard:loop <- pine:collection` | collections | 1 | 16 |
| `object op dropped: cell:text <- pine:reassign` | imperative | 1 | 14 |
| `label.new` | drawing-objects | 1 | 10 |
| `[known-divergence]` | known-divergence | 1 | 9 |
| `object op dropped: guard:create <- pine:function` | builtin-missing | 1 | 9 |
| `object op dropped: prop:unreadable` | drawing-objects | 1 | 9 |
| `object op dropped: create:line <- pine:reassign` | imperative | 1 | 8 |
| `object op dropped: fn:conditional-history` | drawing-objects | 1 | 8 |
| `object op dropped: create:label <- pine:text-value` | text-colour-values | 1 | 7 |
| `object op dropped: create:label <- pine:request` | request-security | 1 | 6 |
| `object op dropped: guard:loop <- pine:block` | imperative | 1 | 6 |
| `array.unshift` | collections | 1 | 4 |
| `object op dropped: guard:create <- pine:request` | request-security | 1 | 4 |
| `object op dropped: guard:loop <- pine:builtin` | builtin-missing | 1 | 4 |
| `ta.valuewhen` | builtin-missing | 1 | 3 |
| `object op dropped: create:label <- pine:function` | builtin-missing | 1 | 2 |
| `[drawing-never-attempted]` | drawing-never-attempted | 1 | 1 |
| `object op dropped: guard:update <- pine:collection` | collections | 1 | 1 |
| `[tuples]` | tuples | 0 | 48 |
| `object op dropped: coll:diverged` | drawing-objects | 0 | 27 |
| `object op dropped: loop:empty` | drawing-objects | 0 | 25 |
| `line.new` | drawing-objects | 0 | 13 |
| `object op dropped: loop:bounds` | drawing-objects | 0 | 13 |
| `object op dropped: content:lost` | drawing-objects | 0 | 12 |
| `object op dropped: cell:text <- pine:builtin` | builtin-missing | 0 | 11 |
| `object op dropped: cell:text <- pine:request` | request-security | 0 | 11 |
| `object op dropped: coll:push` | drawing-objects | 0 | 10 |
| `object op dropped: geometry:lost` | drawing-objects | 0 | 10 |
| `object op dropped: geometry:withheld` | drawing-objects | 0 | 10 |
| `object op dropped: guard:update <- pine:state` | imperative | 0 | 10 |
| `object op dropped: guard:create <- pine:collection` | collections | 0 | 9 |
| `box.new` | drawing-objects | 0 | 8 |
| `object op dropped: guard:create <- pine:builtin` | builtin-missing | 0 | 8 |
| `object op dropped: guard:create <- pine:reassign` | imperative | 0 | 8 |

By capability bucket (`capabilities.touched` / `.sole`):

| capability bucket | sole | any |
|---|---:|---:|
| `[imperative]` | 48 | 228 |
| `[strategy]` | 37 | 70 |
| `[request-security]` | 22 | 67 |
| `[drawing-objects]` | 17 | 111 |
| `[imports-libraries]` | 11 | 61 |
| `[user-functions]` | 9 | 64 |
| `[collections]` | 9 | 53 |
| `[compute-budget]` | 9 | 11 |
| `[builtin-missing]` | 8 | 62 |
| `[translator-robustness]` | 5 | 24 |
| `[output-contract]` | 5 | 7 |
| `[history-offsets]` | 4 | 26 |
| `[text-colour-values]` | 4 | 22 |
| `[udt-methods]` | 3 | 36 |
| `[paint-withheld]` | 2 | 18 |
| `[tuples]` | 1 | 59 |
| `[known-divergence]` | 1 | 9 |
| `[drawing-never-attempted]` | 1 | 1 |
| `[call-mapping]` | 0 | 10 |

Host pairs (scripts with exactly these two walls):

| wall A + wall B | scripts |
|---|---:|
| `[imperative]` + `[tuples]` | 10 |
| `[imperative]` + `[user-functions]` | 9 |
| `[imperative]` + `[paint-withheld]` | 4 |
| `[imperative]` + `[strategy]` | 4 |
| `[request-security]` + `[user-functions]` | 4 |
| `[imports-libraries]` + `[user-functions]` | 3 |
| `[compute-budget]` + `[strategy]` | 2 |
| `[drawing-objects]` + `[translator-robustness]` | 2 |
| `[history-offsets]` + `[user-functions]` | 2 |
| `[imperative]` + `[request-security]` | 2 |
| `[imperative]` + `array.get` | 2 |
| `[imports-libraries]` + `[strategy]` | 2 |
| `[request-security]` + `object op dropped: cell:text <- pine:request` | 2 |
| `[call-mapping]` + `[imports-libraries]` | 1 |
| `[collections]` + `[imperative]` | 1 |
| `[drawing-objects]` + `[imports-libraries]` | 1 |
| `[drawing-objects]` + `[udt-methods]` | 1 |
| `[history-offsets]` + `[imperative]` | 1 |
| `[history-offsets]` + `[paint-withheld]` | 1 |
| `[history-offsets]` + `object op dropped: create:label <- pine:function` | 1 |

**What stops each host sole bucket for a member.** For the scripts whose ONLY host wall is the bucket,
the member-facing walls (section 4), counted per wall; `(served on the runtime lane)` = drawn by the
runtime lane and admitted:

- `[imperative]` (sole of 40): `(served on the runtime lane)` 16, `admission:request-other` 8, `runtime:conditional-history` 7, `pine:builtin` 4, `runtime:statement` 4, `admission:varip` 3, `pine:function` 3, `runtime:history-dynamic-offset` 3, `runtime:request-with-state` 3, `pine:request` 2, `runtime:call-undeclared-builtin-state` 2, `runtime:colour` 2, `runtime:function` 2, `runtime:function-global-state` 2, `runtime:withheld-all` 2, `admission:collections:map` 1, `admission:collections:matrix` 1, `admission:obj:linefill` 1, `lower-tf:store-unmeasured` 1, `pine:state` 1, `runtime:block-value` 1, `runtime:call-conversion-state` 1, `runtime:expression-statement` 1, `runtime:loop` 1, `runtime:request` 1
- `[strategy]` (sole of 37): `[strategy]` 37, `pine:strategy-call` 4
- `[request-security]` (sole of 15): `admission:request-other` 15, `pine:request` 11, `host:pine:constant-only` 3, `runtime:request-with-state` 3, `lower-tf:lookahead` 1
- `[imports-libraries]` (sole of 11): `admission:import` 11, `runtime:library` 11, `pine:builtin` 7, `admission:method-def` 4, `admission:obj:linefill` 4, `runtime:call-undeclared-builtin-state` 4, `runtime:unbound` 4, `admission:collections:map` 3, `admission:library:TradingView/ZigZag/7` 3, `admission:obj:polyline` 3, `runtime:statement` 3, `admission:calc-bars` 2, `admission:collections:matrix` 2, `admission:library:Trendoscope/utils/6` 2, `admission:library:BarefootJoey/AstroLib/1` 1, `admission:library:HeWhoMustNotBeNamed/arraymethods/1` 1, `admission:library:RicardoSantos/MathOperator/2` 1, `admission:library:TFlab/AlertSenderLibrary_TradingFinder/1` 1, `admission:library:TFlab/FVGDetectorLibrary/1` 1, `admission:library:TFlab/LiquidityFinderLibrary/1` 1, `admission:library:TFlab/OrderBlockDrawing_TradingFinder/1` 1, `admission:library:TFlab/OrderBlockRefiner_TradingFinder/2` 1, `admission:library:TradingView/ZigZag/9` 1, `admission:library:TradingView/ta/7` 1, `admission:library:Trendoscope/Drawing/2` 1, `admission:library:Trendoscope/LineWrapper/2` 1, `admission:library:Trendoscope/TradeTracker/1` 1, `admission:library:Trendoscope/Zigzag/11` 1, `admission:library:Trendoscope/ZigzagLite/4` 1, `admission:library:Trendoscope/abstractchartpatterns/10` 1, `admission:library:Trendoscope/basechartpatterns/9` 1, `admission:library:Trendoscope/iLogger/1` 1, `admission:library:Trendoscope/ohlc/3` 1, `admission:library:Trendoscope/reversalchartpatterns/2` 1, `admission:library:algotraderdev/contrast/1` 1, `admission:library:kaigouthro/hsvColor/15` 1, `admission:library:reees/Algebra/3` 1, `admission:library:reees/TA/11` 1, `admission:request-other` 1, `runtime:array` 1, `runtime:expression-statement` 1, `runtime:function` 1, `runtime:history-dynamic-offset` 1, `runtime:history-expression` 1, `runtime:no-output` 1, `runtime:udt-method` 1
- `[compute-budget]` (sole of 9): `(served on the runtime lane)` 4, `admission:request-other` 4, `budget:lookback` 3, `admission:obj:linefill` 1, `budget:series` 1, `pine:builtin` 1, `pine:drawing` 1, `pine:function` 1, `pine:request` 1
- `[user-functions]` (sole of 9): `admission:request-other` 7, `pine:function` 5, `runtime:request-with-state` 4, `runtime:fill-target` 3, `(served on the runtime lane)` 1, `pine:builtin` 1, `runtime:call-undeclared-builtin-state` 1, `runtime:conditional-history` 1, `runtime:history-dynamic-offset` 1
- `[output-contract]` (sole of 5): `pine:function` 2, `runtime:no-output` 2, `admission:request-other` 1, `host:pine:constant-only` 1, `host:pine:presentation-only` 1, `runtime:expression-statement` 1, `runtime:function` 1
- `[translator-robustness]` (sole of 5): `(served on the runtime lane)` 3, `admission:request-other` 1, `runtime:directive` 1, `runtime:request` 1, `runtime:statement` 1
- `[history-offsets]` (sole of 4): `host:pine:constant-only` 3, `pine:offset-literal` 2, `pine:window` 1, `runtime:history-dynamic-offset` 1
- `[drawing-objects]` (sole of 3): `host:pine:constant-only` 2, `(served on the runtime lane)` 1, `admission:method-def` 1, `admission:obj:linefill` 1, `admission:obj:polyline` 1, `admission:request-other` 1
- `[udt-methods]` (sole of 3): `admission:method-def` 2, `admission:request-other` 2, `admission:collections:map` 1, `pine:builtin` 1, `pine:type` 1, `runtime:block-value` 1, `runtime:call-undeclared-builtin-state` 1, `runtime:conditional-history` 1, `runtime:function-global-state` 1, `runtime:loop` 1, `runtime:request` 1, `runtime:udt-method` 1
- `[paint-withheld]` (sole of 2): `[paint-withheld]` 2
- `[text-colour-values]` (sole of 2): `(served on the runtime lane)` 1, `runtime:colour` 1
- `[drawing-never-attempted]` (sole of 1): `admission:method-def` 1, `admission:obj:linefill` 1, `runtime:expression-statement` 1, `runtime:statement` 1, `runtime:udt-method` 1
- `[known-divergence]` (sole of 1): `[known-divergence]` 1

Under `[imperative]`'s 40: 16 are served. Of the other 24, the runtime lane's named walls are those
listed. With the 11-17 map they are `runtime:conditional-history`, `runtime:request-with-state`,
`pine:request`, `runtime:function-global-state`, `runtime:statement`,
`runtime:history-dynamic-offset`, `runtime:block-value`, `runtime:function`, `runtime:colour`,
`lower-tf:*`, `runtime:withheld-all` and `runtime:loop`. This page adds the admission walls:
`request-other` stands in front of 8 of them and `varip` in front of 3.

## 4. The member-facing walls

### 4.1 Every wall: sole and any

248 walls. "Sole, fully enumerated" counts the sole scripts whose peel reached a build, so no
wall hides behind the one named; the rest may hide more (an upper bound). The JSON gives each wall's sole
scripts.

| wall | unit | sole | sole, fully enumerated | any |
|---|---|---:|---:|---:|
| `[strategy]` | `strategy` | 38 | 18 | 70 |
| `pine:function` | `builtins` | 4 | 3 | 53 |
| `runtime:conditional-history` | `conditional-history` | 4 | 3 | 31 |
| `admission:obj:linefill` | `admit:obj:linefill` | 4 | 4 | 19 |
| `pine:builtin` | `builtins` | 3 | 2 | 89 |
| `runtime:statement` | `statements` | 3 | 2 | 37 |
| `runtime:function-global-state` | `function-global-state` | 3 | 1 | 14 |
| `runtime:colour` | `colour` | 3 | 2 | 13 |
| `runtime:call-undeclared-builtin-state` | `builtins` | 2 | 2 | 54 |
| `runtime:history-dynamic-offset` | `dynamic-history` | 2 | 1 | 24 |
| `object op dropped: update:props` | `objects` | 2 | 2 | 11 |
| `admission:collections:matrix` | `admit:collections:matrix` | 2 | 2 | 10 |
| `budget:lookback` | `compute-budget` | 2 | 1 | 5 |
| `[paint-withheld]` | `objects` | 2 | 2 | 3 |
| `admission:request-other` | `admit:request-other` | 1 | 1 | 130 |
| `admission:method-def` | `admit:method-def` | 1 | 1 | 25 |
| `host:pine:constant-only` | `output-contract` | 1 | 0 | 14 |
| `runtime:loop` | `loops` | 1 | 1 | 11 |
| `[known-divergence]` | `known-lists` | 1 | 1 | 9 |
| `admission:calc-bars` | `admit:calc-bars` | 1 | 1 | 9 |
| `admission:varip` | `admit:varip` | 1 | 1 | 6 |
| `object op dropped: cell:text <- pine:reassign` | `objects` | 1 | 1 | 6 |
| `runtime:history-expression` | `dynamic-history` | 1 | 0 | 6 |
| `runtime:lower` | `robustness` | 1 | 0 | 6 |
| `object op dropped: guard:loop <- pine:collection` | `objects` | 1 | 1 | 5 |
| `pine:offset-literal` | `dynamic-history` | 1 | 1 | 5 |
| `object op dropped: create:label <- pine:request` | `objects` | 1 | 1 | 4 |
| `runtime:directive` | `statements` | 1 | 0 | 4 |
| `object op dropped: guard:create <- pine:request` | `objects` | 1 | 1 | 3 |
| `object op dropped: guard:loop <- pine:block` | `objects` | 1 | 1 | 3 |
| `runtime:withheld-all` | `output-contract` | 1 | 0 | 3 |
| `runtime:call-conversion-state` | `state-calls` | 1 | 1 | 2 |
| `host:pine:presentation-only` | `output-contract` | 1 | 0 | 1 |
| `object op dropped: create:label <- pine:function` | `objects` | 1 | 1 | 1 |
| `object op dropped: guard:update <- pine:collection` | `objects` | 1 | 1 | 1 |
| `object op dropped: prop:unreadable` | `objects` | 1 | 1 | 1 |
| `runtime:kill-list` | `known-lists` | 1 | 1 | 1 |
| `runtime:output-map` | `output-contract` | 1 | 0 | 1 |
| `runtime:library` | `libraries` | 0 | 0 | 60 |
| `admission:import` | `libraries` | 0 | 0 | 58 |
| `runtime:request-with-state` | `request-with-state` | 0 | 0 | 39 |
| `pine:request` | `request` | 0 | 0 | 35 |
| `runtime:expression-statement` | `statements` | 0 | 0 | 19 |
| `runtime:request` | `request` | 0 | 0 | 17 |
| `pine:strategy-call` | `strategy` | 0 | 0 | 16 |
| `runtime:function` | `functions` | 0 | 0 | 13 |
| `runtime:block-value` | `block-value` | 0 | 0 | 12 |
| `object op dropped: loop:empty` | `objects` | 0 | 0 | 11 |
| `lower-tf:store-unmeasured` | `lower-tf` | 0 | 0 | 10 |
| `object op dropped: coll:diverged` | `objects` | 0 | 0 | 10 |
| `runtime:no-output` | `output-contract` | 0 | 0 | 10 |
| `admission:obj:polyline` | `admit:obj:polyline` | 0 | 0 | 9 |
| `admission:collections:map` | `admit:collections:map` | 0 | 0 | 8 |
| `object op dropped: loop:bounds` | `objects` | 0 | 0 | 8 |
| `pine:type` | `types` | 0 | 0 | 8 |
| `runtime:unbound` | `statements` | 0 | 0 | 8 |
| `admission:unreadable` | `detector` | 0 | 0 | 7 |
| `runtime:nothing-drawn` | `objects` | 0 | 0 | 7 |
| `admission:library:TradingView/ta/11` | `libraries` | 0 | 0 | 6 |
| `admission:library:TradingView/ta/12` | `libraries` | 0 | 0 | 6 |
| `pine:arity` | `call-mapping` | 0 | 0 | 6 |
| `pine:drawing` | `objects` | 0 | 0 | 6 |
| `runtime:call-text-state` | `state-calls` | 0 | 0 | 6 |
| `pine:collection` | `collections` | 0 | 0 | 5 |
| `pine:library-denied` | `libraries` | 0 | 0 | 5 |
| `pine:state` | `imperative-host` | 0 | 0 | 5 |
| `runtime:fill-target` | `colour` | 0 | 0 | 5 |
| `admission:enum` | `admit:enum` | 0 | 0 | 4 |
| `admission:library:TradingView/ZigZag/7` | `libraries` | 0 | 0 | 4 |
| `admission:library:TradingView/ta/7` | `libraries` | 0 | 0 | 4 |
| `lower-tf:lookahead` | `lower-tf` | 0 | 0 | 4 |
| `object op dropped: coll:push` | `objects` | 0 | 0 | 4 |
| `runtime:call-windowed-state` | `state-calls` | 0 | 0 | 4 |
| `runtime:object-op` | `objects` | 0 | 0 | 4 |
| `admission:library:PineCoders/Time/5` | `libraries` | 0 | 0 | 3 |
| `admission:library:loxx/loxxexpandedsourcetypes/4` | `libraries` | 0 | 0 | 3 |
| `object op dropped: cell:text <- pine:request` | `objects` | 0 | 0 | 3 |
| `object op dropped: cell:text <- pine:text-value` | `objects` | 0 | 0 | 3 |
| `object op dropped: content:lost` | `objects` | 0 | 0 | 3 |
| `object op dropped: create:label <- pine:tuple` | `objects` | 0 | 0 | 3 |
| `object op dropped: create:line <- pine:reassign` | `objects` | 0 | 0 | 3 |
| `object op dropped: create:line <- pine:tuple` | `objects` | 0 | 0 | 3 |
| `object op dropped: fn:conditional-history` | `objects` | 0 | 0 | 3 |
| `object op dropped: geometry:lost` | `objects` | 0 | 0 | 3 |
| `object op dropped: geometry:withheld` | `objects` | 0 | 0 | 3 |
| `object op dropped: guard:create <- pine:builtin` | `objects` | 0 | 0 | 3 |
| `object op dropped: guard:create <- pine:tuple` | `objects` | 0 | 0 | 3 |
| `pine:window` | `dynamic-history` | 0 | 0 | 3 |
| `runtime:array` | `collections` | 0 | 0 | 3 |
| `runtime:udt-method` | `functions` | 0 | 0 | 3 |
| `runtime:varip` | `realtime` | 0 | 0 | 3 |
| `[output-contract]` | `output-contract` | 0 | 0 | 2 |
| `admission:library:PineCoders/VisibleChart/5` | `libraries` | 0 | 0 | 2 |
| `admission:library:PineCoders/lower_tf/5` | `libraries` | 0 | 0 | 2 |
| `admission:library:TFlab/AlertSenderLibrary_TradingFinder/1` | `libraries` | 0 | 0 | 2 |
| `admission:library:TradingView/ta/10` | `libraries` | 0 | 0 | 2 |
| `admission:library:TradingView/ta/8` | `libraries` | 0 | 0 | 2 |
| `admission:library:Trendoscope/Zigzag/11` | `libraries` | 0 | 0 | 2 |
| `admission:library:Trendoscope/utils/6` | `libraries` | 0 | 0 | 2 |
| `box.new` | `objects` | 0 | 0 | 2 |
| `label.new` | `objects` | 0 | 0 | 2 |
| `line.new` | `objects` | 0 | 0 | 2 |
| `lower-tf:unwitnessed` | `lower-tf` | 0 | 0 | 2 |
| `object op dropped: cell:text <- pine:collection` | `objects` | 0 | 0 | 2 |
| `object op dropped: content:withheld` | `objects` | 0 | 0 | 2 |
| `object op dropped: create:label <- pine:text-value` | `objects` | 0 | 0 | 2 |
| `object op dropped: create:line <- pine:block` | `objects` | 0 | 0 | 2 |
| `object op dropped: create:line <- pine:request` | `objects` | 0 | 0 | 2 |
| `object op dropped: guard:coll_push <- pine:undefined` | `objects` | 0 | 0 | 2 |
| `object op dropped: guard:create <- pine:collection` | `objects` | 0 | 0 | 2 |
| `object op dropped: guard:create <- pine:state` | `objects` | 0 | 0 | 2 |
| `object op dropped: guard:create <- pine:undefined` | `objects` | 0 | 0 | 2 |
| `object op dropped: guard:delete <- pine:collection` | `objects` | 0 | 0 | 2 |
| `object op dropped: guard:delete <- pine:tuple` | `objects` | 0 | 0 | 2 |
| `object op dropped: guard:loop <- pine:reassign` | `objects` | 0 | 0 | 2 |
| `object op dropped: guard:update <- pine:reassign` | `objects` | 0 | 0 | 2 |
| `object op dropped: guard:update <- pine:state` | `objects` | 0 | 0 | 2 |
| `object op dropped: guard:update <- pine:tuple` | `objects` | 0 | 0 | 2 |
| `object op dropped: guard:update <- pine:type` | `objects` | 0 | 0 | 2 |
| `pine:colour-value` | `colour` | 0 | 0 | 2 |
| `pine:statement` | `statements` | 0 | 0 | 2 |
| `runtime:enum` | `types` | 0 | 0 | 2 |
| `admission:library:BarefootJoey/AstroLib/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:ClassicScott/MyMovingAveragesLibrary/4` | `libraries` | 0 | 0 | 1 |
| `admission:library:ClassicScott/MyVolatilityBands/7` | `libraries` | 0 | 0 | 1 |
| `admission:library:DskyzInvestments/DafeVisLib/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:DskyzInvestments/MarketStructureLib/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:Fontiramisu/fontilab/11` | `libraries` | 0 | 0 | 1 |
| `admission:library:HeWhoMustNotBeNamed/arraymethods/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:HeWhoMustNotBeNamed/arrayutils/10` | `libraries` | 0 | 0 | 1 |
| `admission:library:HeWhoMustNotBeNamed/customcandles/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:HeWhoMustNotBeNamed/zigzag/5` | `libraries` | 0 | 0 | 1 |
| `admission:library:HoanGhetti/SimpleTrendlines/3` | `libraries` | 0 | 0 | 1 |
| `admission:library:HoanGhetti/SimpleTrendlines/4` | `libraries` | 0 | 0 | 1 |
| `admission:library:LucF/ta/3` | `libraries` | 0 | 0 | 1 |
| `admission:library:MUQWISHI/CandlestickPatterns/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:PineCoders/ConditionalAverages/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:PineCoders/Time/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:PineCoders/VisibleChart/3` | `libraries` | 0 | 0 | 1 |
| `admission:library:PineCoders/getSeries/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:PineCoders/lower_tf/4` | `libraries` | 0 | 0 | 1 |
| `admission:library:RicardoSantos/MathOperator/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:TFlab/FVGDetectorLibrary/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:TFlab/LiquidityFinderLibrary/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:TFlab/OrderBlockDrawing_TradingFinder/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:TFlab/OrderBlockRefiner_TradingFinder/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:TradingView/LibraryCOT/3` | `libraries` | 0 | 0 | 1 |
| `admission:library:TradingView/TechnicalRating/3` | `libraries` | 0 | 0 | 1 |
| `admission:library:TradingView/ValueAtTime/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:TradingView/ZigZag/9` | `libraries` | 0 | 0 | 1 |
| `admission:library:TradingView/ta/14` | `libraries` | 0 | 0 | 1 |
| `admission:library:TradingView/ta/9` | `libraries` | 0 | 0 | 1 |
| `admission:library:Trendoscope/Drawing/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:Trendoscope/Drawing/3` | `libraries` | 0 | 0 | 1 |
| `admission:library:Trendoscope/LineWrapper/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:Trendoscope/TradeTracker/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:Trendoscope/ZigzagLite/4` | `libraries` | 0 | 0 | 1 |
| `admission:library:Trendoscope/abstractchartpatterns/10` | `libraries` | 0 | 0 | 1 |
| `admission:library:Trendoscope/basechartpatterns/9` | `libraries` | 0 | 0 | 1 |
| `admission:library:Trendoscope/iLogger/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:Trendoscope/ohlc/3` | `libraries` | 0 | 0 | 1 |
| `admission:library:Trendoscope/oota/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:Trendoscope/reversalchartpatterns/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:ZenAndTheArtOfTrading/ZenLibrary/9` | `libraries` | 0 | 0 | 1 |
| `admission:library:algotraderdev/contrast/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:boitoki/AwesomeColor/9` | `libraries` | 0 | 0 | 1 |
| `admission:library:boitoki/Utilities/11` | `libraries` | 0 | 0 | 1 |
| `admission:library:jdehorty/KernelFunctions/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:jdehorty/MLExtensions/2` | `libraries` | 0 | 0 | 1 |
| `admission:library:kaigouthro/hsvColor/15` | `libraries` | 0 | 0 | 1 |
| `admission:library:loxx/loxxmas/1` | `libraries` | 0 | 0 | 1 |
| `admission:library:reees/Algebra/3` | `libraries` | 0 | 0 | 1 |
| `admission:library:reees/TA/11` | `libraries` | 0 | 0 | 1 |
| `admission:library:theEccentricTrader/PubLibPattern/4` | `libraries` | 0 | 0 | 1 |
| `admission:library:theEccentricTrader/PubLibSwing/3` | `libraries` | 0 | 0 | 1 |
| `array.remove` | `collections` | 0 | 0 | 1 |
| `box.set_text_font_family` | `objects` | 0 | 0 | 1 |
| `budget:series` | `compute-budget` | 0 | 0 | 1 |
| `host:pine:object-removal-lost` | `objects` | 0 | 0 | 1 |
| `host:pine:objects-only` | `objects` | 0 | 0 | 1 |
| `host:unnamed` | `robustness` | 0 | 0 | 1 |
| `object op dropped: cell:target` | `objects` | 0 | 0 | 1 |
| `object op dropped: cell:text <- loop:per-pass` | `objects` | 0 | 0 | 1 |
| `object op dropped: cell:text <- pine:block` | `objects` | 0 | 0 | 1 |
| `object op dropped: cell:text <- pine:builtin` | `objects` | 0 | 0 | 1 |
| `object op dropped: cell:text <- pine:function` | `objects` | 0 | 0 | 1 |
| `object op dropped: cell:text <- pine:input-kind` | `objects` | 0 | 0 | 1 |
| `object op dropped: cell:text <- pine:state` | `objects` | 0 | 0 | 1 |
| `object op dropped: cell:text <- pine:type` | `objects` | 0 | 0 | 1 |
| `object op dropped: cell:text <- pine:undefined` | `objects` | 0 | 0 | 1 |
| `object op dropped: cell:text <- pine:window-dependent` | `objects` | 0 | 0 | 1 |
| `object op dropped: coll:set` | `objects` | 0 | 0 | 1 |
| `object op dropped: create:box <- pine:tuple` | `objects` | 0 | 0 | 1 |
| `object op dropped: create:label <- pine:drawing` | `objects` | 0 | 0 | 1 |
| `object op dropped: create:label <- pine:type` | `objects` | 0 | 0 | 1 |
| `object op dropped: create:line <- loop:per-pass` | `objects` | 0 | 0 | 1 |
| `object op dropped: create:line <- pine:drawing` | `objects` | 0 | 0 | 1 |
| `object op dropped: create:line <- pine:text-value` | `objects` | 0 | 0 | 1 |
| `object op dropped: create:line <- pine:type` | `objects` | 0 | 0 | 1 |
| `object op dropped: create:line <- pine:undefined` | `objects` | 0 | 0 | 1 |
| `object op dropped: delete:target` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:cell <- pine:object-condition` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:cell <- pine:reassign` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:cell <- pine:type` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:coll_pop <- pine:builtin` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:coll_push <- pine:builtin` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:coll_push <- pine:drawing` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:coll_push <- pine:function-def` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:coll_push <- pine:object-condition` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:coll_push <- pine:type` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:coll_shift <- pine:function-def` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:coll_unshift <- pine:builtin` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:copy <- pine:state` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:create <- pine:drawing` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:create <- pine:function-def` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:create <- pine:input-kind` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:create <- pine:object-condition` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:create <- pine:reassign` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:create <- pine:statement` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:create <- pine:type` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:delete <- pine:builtin` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:delete <- pine:function-def` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:delete <- pine:object-condition` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:delete <- pine:reassign` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:delete <- pine:request` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:delete <- pine:state` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:delete <- pine:statement` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:loop <- pine:builtin` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:loop <- pine:function-def` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:partial <- pine:builtin` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:partial <- pine:type` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:update <- pine:builtin` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:update <- pine:drawing` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:update <- pine:input-kind` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:update <- pine:object-condition` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:update <- pine:request` | `objects` | 0 | 0 | 1 |
| `object op dropped: guard:update <- pine:statement` | `objects` | 0 | 0 | 1 |
| `object op dropped: update:target` | `objects` | 0 | 0 | 1 |
| `pine:block` | `imperative-host` | 0 | 0 | 1 |
| `pine:input-kind` | `call-mapping` | 0 | 0 | 1 |
| `pine:member` | `types` | 0 | 0 | 1 |
| `pine:text-value` | `colour` | 0 | 0 | 1 |
| `pine:window-dependent` | `dynamic-history` | 0 | 0 | 1 |
| `polyline.*` | `objects` | 0 | 0 | 1 |
| `polyline.delete.*` | `objects` | 0 | 0 | 1 |
| `runtime:builtin-args` | `state-calls` | 0 | 0 | 1 |
| `runtime:clock-zone` | `builtins` | 0 | 0 | 1 |
| `runtime:input-state` | `state-calls` | 0 | 0 | 1 |

### 4.2 Pairs: scripts blocked by exactly two walls

By wall (the top 30; the JSON holds 60 with their scripts):

| wall A + wall B | scripts |
|---|---:|
| `admission:request-other` + `pine:request` | 14 |
| `admission:request-other` + `runtime:request-with-state` | 8 |
| `[strategy]` + `pine:strategy-call` | 7 |
| `admission:request-other` + `runtime:request` | 4 |
| `admission:request-other` + `pine:function` | 3 |
| `[strategy]` + `runtime:request-with-state` | 2 |
| `admission:request-other` + `lower-tf:store-unmeasured` | 2 |
| `host:pine:constant-only` + `pine:offset-literal` | 2 |
| `pine:function` + `runtime:call-undeclared-builtin-state` | 2 |
| `[known-divergence]` + `[paint-withheld]` | 1 |
| `[known-divergence]` + `object op dropped: cell:text <- pine:input-kind` | 1 |
| `[known-divergence]` + `object op dropped: cell:text <- pine:reassign` | 1 |
| `[known-divergence]` + `object op dropped: cell:text <- pine:text-value` | 1 |
| `[output-contract]` + `object op dropped: guard:update <- pine:type` | 1 |
| `[strategy]` + `budget:lookback` | 1 |
| `[strategy]` + `object op dropped: create:label <- pine:request` | 1 |
| `[strategy]` + `runtime:conditional-history` | 1 |
| `[strategy]` + `runtime:expression-statement` | 1 |
| `admission:request-other` + `host:pine:constant-only` | 1 |
| `admission:request-other` + `host:pine:object-removal-lost` | 1 |
| `admission:request-other` + `lower-tf:lookahead` | 1 |
| `admission:request-other` + `pine:arity` | 1 |
| `admission:request-other` + `pine:window-dependent` | 1 |
| `admission:request-other` + `runtime:call-undeclared-builtin-state` | 1 |
| `admission:varip` + `runtime:conditional-history` | 1 |
| `admission:varip` + `runtime:function-global-state` | 1 |
| `box.set_text_font_family` + `object op dropped: loop:bounds` | 1 |
| `host:pine:constant-only` + `pine:function` | 1 |
| `host:pine:constant-only` + `pine:window` | 1 |
| `object op dropped: cell:text <- loop:per-pass` + `object op dropped: loop:empty` | 1 |

By unit (two walls of the same unit count as one; the top 25):

| unit A + unit B | scripts |
|---|---:|
| `admit:request-other` + `request` | 18 |
| `admit:request-other` + `request-with-state` | 8 |
| `known-lists` + `objects` | 8 |
| `admit:request-other` + `builtins` | 5 |
| `builtins` + `libraries` | 5 |
| `dynamic-history` + `output-contract` | 4 |
| `admit:request-other` + `lower-tf` | 3 |
| `admit:request-other` + `libraries` | 2 |
| `builtins` + `conditional-history` | 2 |
| `builtins` + `output-contract` | 2 |
| `conditional-history` + `statements` | 2 |
| `dynamic-history` + `statements` | 2 |
| `objects` + `output-contract` | 2 |
| `request-with-state` + `strategy` | 2 |
| `admit:request-other` + `call-mapping` | 1 |
| `admit:request-other` + `dynamic-history` | 1 |
| `admit:request-other` + `objects` | 1 |
| `admit:request-other` + `output-contract` | 1 |
| `admit:varip` + `conditional-history` | 1 |
| `admit:varip` + `function-global-state` | 1 |
| `block-value` + `robustness` | 1 |
| `builtins` + `colour` | 1 |
| `builtins` + `dynamic-history` | 1 |
| `builtins` + `function-global-state` | 1 |
| `builtins` + `statements` | 1 |

**What the pairs say.** `admission:request-other` is the gate in front of every request unit:
- 18 scripts are `request` plus its admission, 8 are `request-with-state` plus its admission, and 3 are
  `lower-tf` plus its admission;
- 130 scripts carry the admission wall, against 1 where it is the only one.

So no request engine work reaches a member until the `request-other` capability is admitted (U-REQ-OTHER),
and that admission frees little on its own. Every host-listed script that is also dirty on the host lane
pairs with `objects` (8).

### 4.3 Which names each wall stops on

The runtime lane's own token per wall, counted over the scripts not served (Pine names only; a script's
own identifiers are counted as one row). This is each unit's queue:

- `pine:builtin`: `(a script's own identifier)` 41, `barstate.isnew` 6, `chart.fg_color` 6, `timeframe.in_seconds` 5, `chart.left_visible_bar_time` 4, `syminfo.type` 4, `time` 4, `timeframe.change` 4, `chart.bg_color` 3, `chart.right_visible_bar_time` 3, `ticker.heikinashi` 3, `extend.right` 2, `session.isfirstbar` 2, `str.format` 2
- `pine:function`: `(a script's own identifier)` 24, `time` 9, `color` 7, `ta.dmi` 4, `math.e` 2, `ta.sar` 2, `asin` 1, `fill` 1, `math.asin` 1, `math.toradians` 1, `sar` 1, `string` 1, `ta.kc` 1, `time_close` 1
- `runtime:call-undeclared-builtin-state`: `(a script's own identifier)` 37, `chart.point.from_index` 4, `ta.swma` 2, `time` 2, `timeframe.change` 2, `timeframe.from_seconds` 2, `chart.point.copy` 1, `chart.point.from_time` 1, `chart.point.new` 1, `chart.point.now` 1, `correlation` 1, `linreg` 1, `math.toradians` 1, `ta.correlation` 1
- `runtime:statement`: `(a script's own identifier)` 12, `time` 6, `color.new` 2, `ta.pivothigh` 2, `ta.pivotlow` 2, `array.max` 1, `array.min` 1, `array.new_float` 1, `box` 1, `color` 1, `float` 1, `for` 1, `int` 1, `min` 1
- `runtime:conditional-history`: `(a script's own identifier)` 9, `and` 7, `if` 1, `ta.highest` 1, `ta.lowest` 1, `ta.sma` 1
- `runtime:history-dynamic-offset`: `(a script's own identifier)` 9, `ta.wma` 2, `wma` 2, `math.sum` 1, `rsi` 1, `sma` 1, `ta.atr` 1, `ta.ema` 1, `ta.sma` 1
- `runtime:function-global-state`: `ta.change` 2, `(a script's own identifier)` 1, `ta.highest` 1, `ta.lowest` 1, `ta.sma` 1
- `runtime:request-with-state`: `security` 24, `request.security` 8, `request.security_lower_tf` 7
- `pine:request`: `request.security` 12, `security` 12, `request.security_lower_tf` 7, `request.dividends` 2, `request.earnings` 2, `request.splits` 2, `request.footprint` 1
- `runtime:request`: `request.security` 15
- `lower-tf:store-unmeasured`: `request.security` 10
- `runtime:colour`: `color.new` 7, `and` 1, `barcolor` 1, `bgcolor` 1, `fill` 1, `ta.max` 1
- `runtime:block-value`: `(a script's own identifier)` 8, `switch` 5, `if` 3
- `runtime:loop`: `for` 11
- `runtime:call-text-state`: `str.tostring` 4, `str.format` 1, `tostring` 1
- `runtime:call-windowed-state`: `ta.vwap` 2, `ta.pivothigh` 1, `ta.pivotlow` 1, `vwap` 1
- `runtime:array`: `(a script's own identifier)` 1, `array.percentrank` 1, `array.standardize` 1
- `pine:strategy-call`: `strategy.position_size` 14, `strategy.opentrades` 3, `strategy.position_avg_price` 2, `strategy.netprofit` 1, `strategy.opentrades.entry_price` 1, `strategy.opentrades.size` 1
- `budget:lookback`: `(a script's own identifier)` 4, `if` 1, `plotshape` 1

`runtime:conditional-history` stopping on `and` in 7 scripts is Pine v6's lazy `and` / `or`: a call on
the right of `and` runs only on bars where the left is true, so it keeps call-site history.

### 4.4 Three walls the 1D census cannot see (added 2026-11-18)

The census runs every script on one daily chart whose history starts at RDDT's 2024 listing. A wall that
needs an intraday chart, or a longer history, does not show in its rows. Two were measured tonight by
other sessions and are recorded with their witnesses (`externalWalls`):

| wall | unit | what the census sees of it | witness |
|---|---|---|---|
| **A running value anchored at the first bar (an all-time ratchet, an all-time high, an anchored VWAP reaching past the look-back cap)** (`first-bar-anchor`) | `first-bar-anchor` | host `budget:lookback` (cap 960 bars, ruled not raised 2026-11-17); the runtime lane runs from the first bar the chart hands it, so it is a wall there only when that bar is not TradingView's | measured 2026-11-18 by another session (local): SPY 1D from the 1993 listing, a level rising since the listing is 82% bar-equal to a windowed value at W=900 and 20% off at worst; McGinley 14 (a decaying recurrence) is bit-equal at W=300. A decaying recurrence converges inside a window; a running extreme or sum does not, at any W the cap allows |
| **A DAILY read on an intraday chart (previous day's high / low / close, daily pivots): a request.security to a higher timeframe** (`daily-on-intraday`) | `request` | host `tf` reads weekly and monthly only (`pine:request`: "another timeframe as `tf` (weekly and monthly ...)"); the session-reader spelling exceeds `budget:lookback` (1361 vs 960). On the 1D census a "D" request is the chart's own timeframe, so it never shows | measured 2026-11-18 by the Create Indicator capability census (local REPORT.md): 2 of 177 ideas (previous day H/L/C, daily pivots) blocked by exactly this |
| **U-CONFIRM: when TradingView confirms a closed daily bar for a strategy** (`strategy-bar-confirm`, kind `evidence`: an open question, not an engine gap) | `strategy` | the census treats every closed bar as confirmed; the grade cuts only an ABSENT newest value row of a strategy capture (an `na` row, or a row missing anywhere else, is compared) | r1-strategy-draws-rddt-1d-2026-10-02: 636 bars and 635 value rows, bar 635's session closed at 20:00Z and the capture was taken at 22:57Z (`newestBarIsForming` false); its indicator twin (no broker) holds all 636. The 2026-11-16 report captures (22:09-23:18Z) hold the same shape |

All three are written up in section 5 (U-DAILY, U-ANCHOR, U-CONFIRM). They carry no sample count, because
nothing has measured one. The census needs an intraday chart and a long-history chart before this can change.

### 4.5 The Create Indicator capability census, classified against Pine

The Create Indicator capability census (2026-11-18, local `reports/indicator-ecosystem/capability-census/
2026-11-18/REPORT.md`) measured what our FORMULA language cannot write, from 177 ideas. Its classes are
mapped here to the Pine construct that does each, and then to this roadmap: a wall (its unit), a data
decision, or never-serve (`authoringClasses`):

| reason (capability census) | ideas | the Pine construct | classification | roadmap unit | note |
|---|---:|---|---|---|---|
| drawn objects | 9 | line / box / label / polyline objects | wall | objects | Pine imports already draw line / label / box / table (admitted); the authoring vocabulary does not ask for them |
| pattern search of no fixed length | 6 | loops, arrays and `var` state over swings (runtime lane) | wall | loops / collections / conditional-history | the host lane decides a formula's history before it runs, by design; the runtime lane is the route |
| many symbols at once (breadth, ranks) | 5 | published breadth symbols (USI:, INDEX:), <= 40 request.* calls, a registered seed (RS rating) | data decision | breadth / indices; request (a 20-symbol table) | a market-wide rank through time is not a Pine built-in: TradingView serves it only as a symbol or a seed |
| history of a non-price series | 5 | request.earnings (earnings), request.financial (EPS, sales) | never-serve / data decision | corporate-events (earnings); never-serve fundamentals (EPS, sales) | short interest, implied volatility rank and news have no Pine construct: outside Pine parity |
| time of day across sessions, non-regular sessions | 4 | arrays / maps keyed by time; an extended-session ticker (ticker.new with session.extended) | wall | collections; request (extended session); first-bar-anchor (seasonality) | Globex / Asia / London ranges of a futures or foreign feed are never-serve (other feeds) |
| plot styles | 3 | plot.style_circles with a series colour, plotcandle, a positive plot offset | wall | output-contract / colour | presentation the pane does not carry yet |
| bars smaller than the chart's, ticks | 3 | request.security_lower_tf; request.footprint, bid / ask | wall / never-serve | lower-tf; never-serve footprint-ticks | intrabar bars from our intraday store are a wall; trades and quotes are not ours |
| volume or time by price level | 2 | no built-in; community scripts bin lower-timeframe bars into arrays and boxes (request.footprint for the real one) | wall / never-serve | lower-tf + collections + objects; never-serve footprint-ticks | a profile from lower-timeframe bars is buildable; a tick-exact one is not |
| bars not built on time (Renko, Kagi, P&F) | 1 | ticker.renko / ticker.kagi / ticker.pointfigure inside request.security | wall | request (synthetic tickers, as Q-REQ3's Heikin Ashi) | needs TradingView's brick / box rule witnessed per form |

Its largest single class is "a running value": 12 ideas the engine computes and the authoring door refuses
because the assistant's vocabulary leaves `self` out. That is not a Pine wall, because the runtime lane
serves Pine's `var` state. It is an authoring decision, and is out of this roadmap's scope.

## 5. The engineering units

One unit per wall family. Each: what TradingView Pine does (the v6 reference sentence, or a committed
capture), where our runtime lane refuses today, the smallest honest change, the evidence to admit it,
and the risk. File references are `app/src/components/chart/engine/` unless stated; line numbers are
at `99de72e7c0` and are dated claims. "Engine number": a unit that changes what a stored script
computes needs one (`scriptEngineVersion.js`); an evidence-only unit (admission) does not.

### U-OBJ `objects`: drawing objects the object program cannot carry

- **TradingView:** draws every object a script creates (reference, `line.new`: "Creates new line
  object."), keeping the newest up to a count (`indicator(max_lines_count)`: "The system automatically
  deletes the oldest line objects when the number of lines exceeds the limit."); `linefill.new`: "If
  any line of the two is deleted, the linefill object is also deleted."
- **Ours today:** the host lane ATTACHES these scripts with a dirty object program (`lossVerdict` not
  clean): named op drops (`object op dropped: <op> <- <guard>`), withheld paints. Because the host
  attached, the door never offers them to the runtime lane, so the census has no runtime reading of
  them (`runtimeOn.walls.attachedDirtyWalls`, no `rtProbe`). Sites: `ast/objectLoss.js`,
  `ast/pine.js` object program (`OBJECT_CONDITION_WHY`), DRAW-1's drop heads.
- **Smallest honest change:** two routes, measured before either is chosen. (a) The route-by-cost
  pattern (#1711, engine 73): offer a dirty host document to the runtime lane and move it only when
  that lane builds it, admits it and draws the same surface; this needs the census to PROBE the runtime
  lane on attached-dirty rows first (an instrument change, no engine number). (b) Per drop head on the
  host lane, largest first (the wall table names each: `update:props`, `cell:text <- pine:reassign`,
  `guard:loop <- pine:collection`...).
- **Evidence:** a committed capture per freed script grading objects-v2 MATCH; the capability rows
  `obj:*` already admit line / label / box / table. `obj:linefill` and `obj:polyline` are separate
  evidence units below.
- **Risk:** drawing count and position (DRAW-1's known DIVERGE classes: count-at-cap, conditional
  history of a drawing). Route (a) changes no stored document; route (b) does: engine number.
- **Also this unit: a runtime document's drawings owned by its own run** (added 2026-11-18, coordinator
  ruling after the `admit:obj:linefill` re-grade, #1804). AlgoAlpha Trend Targets reaches the runtime lane,
  but the member door keeps the HOST object program (64 ops) in the runtime document: the run owns its
  drawings only where the host program would draw nothing (`memberPaneDefinition.js::runtimeLaneDefinition`
  -> `runtimeOwnObjectsOf`). So its lines, labels and linefills are the host lane's (`objectsLane` host), and
  the script is evidence for no object family. Its run DOES build with its drawings
  (`probeRuntimeProgram(source, { objectsInRun: true })` succeeds at engine 75), and so do k-clustering's and
  vdubus-pattern-gen-v2's, both host-drawn today. The smallest honest change: let the run own the drawings
  where it builds them and draws the same objects as the host program (route-by-cost's same-surface test,
  applied to the objects), measured capture by capture before any member sees it; no stored document changes.
  Witness owed: AlgoAlpha AMEX:SPY 1D from the listing. Its 2026-11-17 capture, not from the listing, DIVERGES
  on a `barcolor` at bar 200; the 2026-11-15 one, from the listing, grades MATCH. With AlgoAlpha's linefills on
  its own run, FVG Finder and AlgoAlpha are the two scripts `admit:obj:linefill` needs (capture requests for
  vdubus-pattern-gen-v2, k-clustering and FVG Finder SPY sent 2026-11-18). Taken the same day (run `adm-2026-11-18`):
  AlgoAlpha SPY 1D from the listing grades MATCH on the runtime-on lane (the 11-17 DIVERGE was its history start), and
  FVG Finder SPY 1D shows a second objects wall: once the line collector runs at the 500 cap, TradingView holds 289
  linefills and we hold 250 (every one paired agrees), the linefill analogue of `obj:box`'s count-at-cap carve-out.
- **Measured and built 2026-11-18 (PARITY UNIT 1, PR #1824, train e77;
  `docs/pine/evidence/2026-11-18-objects-unit/EVIDENCE.md`).** The probe found the runtime lane builds 14 of the
  55 (`objects` + `known-lists`) and the value lane stops the other 41. Route (a) was built first as a move to a
  runtime document and WITHDRAWN (its server lanes went dark; off the listing its run blanked 256 of SPY's 1,800
  host-drawn bars on `atr-support-and-resistance`). Built instead: the run half draws what the host program lost
  (`runHalfObjectRail.js`, the lost-drawings rule; the document stays the host's): served 275 -> 277
  (`atr-support-and-resistance`, `auto-trendlines-by-pivots`), two more on `request-other`. Open, each a later unit:
  - **Hosts that lost EVERY drawing** (`committed:atr-trailing-stop-by-ceyhun`,
    `reference:liquidity-heatmap-swiftedge`, both admitted; the run half refused `run-half:no-comparable-objects`).
    Their document carries no object program, so the bind cannot tell them from a `removes` host (a lost removal,
    whose run is measured to go silently empty: `fabio-style ... rddt 1d 2026-11-15`, 0 of TradingView's 52
    objects). Needs a door-side discriminator: a stored-document change, engine number.
  - **The per-bar step limit** (`committed:volume-profile`, `reference:fourier-extrapolator-of-price-w-projection-
    forecast-loxx`, both admitted, closed bars): the run stops by name (`runtime:limit`: 205,101 steps on the last
    bar against the 200,000 limit; TradingView draws 203 and 398 lines). ⛔ Measure the per-chart CPU cost of the
    last bar at 250,000 steps before anyone proposes raising the limit.

### U-STRAT `strategy`: order simulation served to members (OWNER-GATED, in progress)

- **TradingView:** reference, `strategy()`: "This declaration statement designates the script as a
  strategy and sets a number of strategy-related properties." Fills, positions and the tester report
  follow the broker emulator (User Manual, Strategies).
- **Ours today:** the broker exists behind the strategy broker gate; `strategy-decl` has no
  capability registry row, so production serves no strategy (`runtime_definitions.admitted_capabilities`;
  engine 72's note). Every order-placing strategy is excluded by the predicate (`places_orders`).
  Refusals: `pine:strategy-call` (host), `runtime:strategy-option` / `runtime:strategy-value` /
  `runtime:strategy-unpinned` (`ast/pineRuntimeFrontend.js:13302`, `:8723`; `runtime/broker.js`).
- **Smallest honest change:** the owner's 11-16 ruling (serve witnessed strategies) through the
  `strategy-decl` registry row, admitted per broker rule pinned in `brokerPins.json` (41 pinned). The
  census already measures the armed column (`strategyOn.wouldTransferIfArmed`).
- **Evidence:** Strategy Tester REPORT captures graded MATCH at step 8, one per broker rule a script
  exercises (`docs/pine/vendor-harness/strategy-verdicts/`); the queued re-takes B-PYR, B-PYR-PRICE,
  B-STOP-LIMIT, B-EXIT-LEVELS and `w9-q-s1a-size-stop-v6`.
- **Risk:** a wrong fill is a wrong P&L a member trusts. No engine number for the registry row; each
  broker rule is its own engine unit (as e68's were).

### U-CONFIRM `strategy-bar-confirm` (part of U-STRAT): when TradingView confirms a closed daily bar (EVIDENCE)

- **TradingView:** a strategy with `calc_on_every_tick = false` (the default) runs a bar once TradingView
  CONFIRMS it. Measured: a strategy captured after the session close can hold a newest bar its strategy has
  not run (no value row there), while an indicator captured on the same chart minutes later holds it.
- **Ours today:** the engine runs every closed bar; it does not guess when TradingView confirms one (coordinator
  ruling 2026-11-18). The harness grades a strategy capture on the bars its strategy RAN: an ABSENT newest value
  row is cut on both sides, keyed on the row being absent, never on an `na` value
  (`__tests__/vendorHarness/strategyLane.js::strategyRanView`, rails `strategyLane.test.js` SL2 / SL2b).
- **Evidence that would pin it:** one strategy captured just before and just after TradingView confirms a closed
  daily bar (the same chart, the same script), so the moment of confirmation is read, not assumed.
- **Risk:** none served today: the question decides one newest bar of a strategy run.

### U-LIB `libraries`: Pine library imports

- **TradingView:** reference, `import`: "Used to load an external library() into a script and bind its
  functions to a namespace. ... A library must be published (privately or publicly) before it can be
  imported."
- **Ours today:** the runtime front end compiles one script, not a library graph:
  `runtime:library` (`ast/pineRuntimeFrontend.js:362`, `:13357`); the host refuses `pine:module`;
  U15's per-version promotion (`ast/pineLibraries.js`, `pine:library-denied` / `-licence` /
  `-changed`) admits a version only as `library:<Author>/<Library>/<N>` in the registry, and none is
  admitted.
- **Smallest honest change:** link a promoted library version's exported functions into the importing
  script's IR (the source pinned by sha256, licence read from its header), first for the one
  TradingView-published library the built-ins import (`TradingView/ZigZag/7`). Libraries are user
  functions, types and methods exported, so this stands on U-FN, U-FGS and U-TYPES (dependency).
- **Evidence:** per version, every importing sample script graded MATCH (U15's rule); the committed
  `vw-library-import` and `lib-v5-in-v6` probes. Missing: community library versions no session has
  fetched or graded (queue rows below).
- **Risk:** a library version that changes under a saved script (`pine:library-changed` guards it);
  non-commercial licences can never be served. Engine number: yes.

### U-REQ-OTHER `admit:request-other`: capability admission of other-symbol / other-timeframe requests

- **TradingView:** reference, `request.security`: "Requests the result of an expression from a
  specified context (symbol and timeframe)."
- **Ours today:** the runtime lane serves `request.security` for a held symbol or a higher timeframe,
  but the capability `request-other` (`api/services/pine_capabilities.py`, `_REQUEST_RX` and the repaint
  classifier's requests) has no admitted registry row, so EVERY script that requests is declined
  `runtime:not-yet-graded` on the member door, whatever its other walls.
- **Smallest honest change:** none in the engine: a `request-other` row in
  `api/data/pine_runtime_allowlist.json` admitted by `rollout_gate.pine_capability_admission`
  (2 runtime-on MATCH captures from 2 scripts, at least 1 community script, closed-bar scope if the
  repaint classifier says so).
- **Evidence:** the runtime-drawn sample scripts with a committed runtime-on MATCH that use it (the
  unit table's `runtimeDrawnWithMatch`), plus the committed `vw-other-symbol`, `vw-request-htf-alignment`
  and `rs-*` captures.
- **Risk:** realtime alignment of a higher timeframe (repainting); scope it to closed bars as
  `realtime-state` is. No engine number.

### U-REQ `request`: request.* for another symbol or timeframe (own-symbol shapes)

- **TradingView:** as above; for the chart's own symbol the reference adds "the symbol of a
  `request.*()` call can be inherited if it is not specified precisely".
- **Ours today:** host `pine:request` (`ast/pine.js:9392`; `otherSymbols.js::staticallyUnservable` /
  `spellingUnservable` name the spelling), runtime `runtime:request`
  (`ast/pineRuntimeFrontend.js:6915`, `:6934`, `:7008`; `runtime/runtimeColumns.js:1317`).
- **Smallest honest change:** by shape, each with its queue row: a Heikin Ashi ticker (Q-REQ3); a
  `barmerge.gaps_*` passed as `lookahead` behind a `[barstate.isconfirmed ? 0 : 1]` offset (Q-REQ2); a
  symbol reached through a helper's parameter. The never-serve and data-decision scripts (section 6)
  are excluded from this unit's count.
- **Evidence:** one capture per shape grading MATCH (the reference does not state these behaviours).
- **Risk:** a request served for a symbol we hold under a different instrument (the bare-ticker class);
  `otherSymbols.js` keeps that refusal. Engine number: yes.

### U-REQ-STATE `request-with-state`: a request whose expression reads a mutable value

- **TradingView:** the reference's own example sends a computed series to another context
  (`request.security("AAPL", "240", sma)`); with `var` state the expression runs in the requested
  context's own bars.
- **Ours today:** `ast/pineRuntimeFrontend.js:6895`: refused before anything is lowered, because
  "a `var` belonging to this chart's run has no meaning" in another symbol's context.
- **Smallest honest change:** run the request's expression as its own sub-program over the requested
  context's bars (its own `var` slots, committed per requested bar), the same seam the lower-timeframe
  runner uses; first for the chart's own symbol at a higher timeframe and the v1-v4 bare `security`
  (Q-REQ4).
- **Evidence:** Q-REQ4 (a bare v1-v4 `security` over state, graded MATCH); a probe of `var` inside a
  higher-timeframe request. Missing: both (queue rows).
- **Risk:** realtime repainting of the requested expression; lookahead. Engine number: yes.

### U-REQ-HOIST-COLUMN `request-hoisted-column` (part of U-REQ): a history read in a request's hoisted statements is read from the chart's bars

Added 2026-11-18 (coordinator ruling, from the PA ZigZag Fibonacci FAN DIVERGE at Alt Timeframe 1W / 1M, run
`rozz-2026-11-18`, local; it is not U-HTF-CALENDAR: NYSE:RDDT's history starts in 2024).
- **TradingView:** the script requests `zigzag()` at the weekly / monthly context (`lookahead_on`). The function's
  `_isUp[1]` and `_isDown[1]` are the PREVIOUS requested bar's: TradingView's model of the script over the weekly and
  monthly folds of its own daily bars reproduces the vendor's `zigzag` on every period (RDDT 140 / 140 weeks and
  33 / 33 months, SPY 1,765 / 1,765 and 407 / 407).
- **Ours today:** the function body (`int _dir = na , _dir := …` is a recurrence, so it is lowered as statements) is
  hoisted into the request's region. Its `_isUp[1]` / `_isDown[1]` are pure subtrees, lowered as COLUMNS of the
  columnar lane, which computes them once over THIS chart's daily bars. The request's sub-run (`vm.js::runRequest`)
  is handed the chart's columns (`columns: ctx.columns`) and reads them at the requested bar's index, so on weekly bar
  j `_isUp[1]` is the chart's daily `close[j-1] >= close[j-2]`. The guard that refuses a column inside a request
  (`pineRuntimeFrontend.js`, `carriesColumn(valueIr)`) walks the request's VALUE only, never its hoisted statements, so
  this one is drawn. Everything else the request reads is right (one request per value, our side, RDDT 1W: `_isUp`,
  `_isDown`, `close[1]`, `ta.highest(2)`, `ta.lowest(2)` equal TradingView's on 140 / 140 weeks), and a model in which
  only those two reads come from the chart's bars reproduces our `zigzag` exactly (140 / 140 weeks, 33 / 33 months).
- **The first bar:** RDDT 1W bar 6 (2024-04-01, the third week). TradingView reads the second week for `_isUp[1]`
  (49.32 >= 46, true), so `_dir` turns -1 and `zigzag` is 74.9; ours reads chart bar 1 (2024-03-22, 46 >= 50.44,
  false): `zigzag` na. The other three captures part at the bars the evidence names (RDDT 1M bar 278, SPY 1W bar 15,
  SPY 1M bar 64).
- **Smallest honest change:** first the guard, because the value is wrong rather than refused: `carriesColumn` walks
  the hoisted statements too, so such a request refuses by name. Then the serve: a history read inside a request's
  region lowered as the region's own slot history (committed per requested bar, as `_dir[1]` already is), never a
  column.
- **Evidence:** the four `rozz-2026-11-18` captures (`pa-zigzag-fibonacci-fan-alt{w,m}-{rddt,spy}-1d-2026-11-17`) are
  the witnesses; today they are graded only through the harness's moved-timeframe switch
  (`docs/pine/evidence/2026-11-18-timeframe-input-setting/EVIDENCE.md`). No member surface draws them: a moved
  timeframe is read-only, and no `request-other` row is admitted. Until the guard lands, a request capture whose
  request region hoists such a read is not `request-other` evidence.
- **Risk:** any requested function body in statement form with a history read of a binding, on another symbol as
  much as another timeframe. Engine number: yes (a value moves, or refuses).

### U-DAILY `daily-on-intraday` (part of U-REQ): a DAILY read on an intraday chart

Added 2026-11-18 by the coordinator, measured by the Create Indicator capability census; **the 1D
census cannot see it** (on a daily chart, "D" is the chart's own timeframe).
- **TradingView:** reference, `request.security`: "Requests the result of an expression from a
  specified context (symbol and timeframe)"; its own example is `request.security(syminfo.tickerid,
  "1D", close)`. Previous day high / low / close and daily pivots on a 5-minute chart are this call.
- **Ours today:** the host lane's `tf` node reads weekly and monthly only (`pine:request`'s sentence
  names it); the roundabout spelling through the session readers exceeds `budget:lookback` (1361 bars
  vs 960). On the runtime lane, a higher-timeframe request is a `request-other` capability, not
  admitted (U-REQ-OTHER).
- **Smallest honest change:** extend `tf` to "D" on an intraday chart, the daily bar being the regular
  session's (the session vocabulary engine 73 added: `sessionHigh` / `sessionLow`, `regularfirst`), read
  with lookahead off as the last completed daily bar; one cost: a daily series beside the intraday one,
  not a 1361-bar window.
- **Evidence:** committed `vw-request-htf-alignment` (3), `request-realtime-alignment` (SPY 5m),
  `vw-tf-period`; missing: a 5-minute and a 15-minute capture of previous-day H/L/C and floor pivots on
  SPY and RDDT (queue row Q-DAILY-1).
- **Risk:** early closes and half-days (the vendor calendar settles them); realtime repainting of the
  forming day (closed-bar scope). Engine number: yes.

### U-HTF-CALENDAR `htf-calendar` (part of U-REQ): a short week or month before TradingView's exchange calendar begins

Added 2026-11-18 (coordinator ruling, from capture A1 `support-and-resistance-multi-time-frame-spy-1d-2026-11-18`,
run `adm-2026-11-18`, local). It is NOT a feed wall: TradingView's weekly and monthly values are folds of its own
daily bars on every bar of that capture (480 of 480 distinct "Resistance Weekly" values, 57 / 57 weekly lows, 159 /
159 monthly highs, 9 / 9 monthly lows equal a period's fold of the daily rows TradingView drew). The switch year was
read 2026-11-18 from Q-HTF-CAL-1a / 1b (below).
- **TradingView:** with look-ahead off, a completed week or month appears on the daily chart on that period's LAST
  session, except a period that ends early (its last session is not the period's last weekday) before TradingView's
  exchange calendar begins: then it appears one bar later, on the next period's first session. **The calendar begins
  in 2000, on AMEX and on NASDAQ alike.** Read off TradingView's own `close` at `"W"` and `"M"` with look-ahead off
  (A02 / A05) on every short period:
  - **through 1999, every short period is shown on the NEXT bar:** AMEX:SPY, 13 weeks (8 April 1993 to 23 December
    1999) and 2 months (May 1993, May 1999); NASDAQ:QQQ (listed March 1999), the weeks of 1 April and 23 December 1999
    and May 1999;
  - **from 2000, every short period is shown on its LAST bar:** the same 46 weeks on both (20 April 2000 to 2 July
    2026) and the same 7 months (March 2002 to March 2024), including the closure of Friday 11 June 2004, which the
    calendar holds;
  - **one exception, on both:** the week of 10 September 2001, whose other sessions (11-14 September) closed without
    notice, is shown on the NEXT bar;
  - no short period falls between 23 December 1999 and 20 April 2000, so the calendar's first day is in that window;
    the reading is 1 January 2000.
  - Controls: every full period is shown on its last bar (SPY 1,701 weeks and 396 months, QQQ 1,394 weeks and 323
    months; 3 weeks whose close equals the week before cannot be read), and no short period reads anything else.
- **Ours today:** `interpret.js::requestAlignment` / `tfMergeReads` show every completed period on its last session,
  whatever the year, so a short period before 2000, and the week of 10 September 2001, read one bar EARLY:
  Resistance Weekly differs on 7 bars, Support Weekly on 2, Resistance Monthly on 1 (patrick-54's grade of A1 SPY:
  8,509 bars, daily S/R equal everywhere).
- **Smallest honest change:** none to the data. A period-close rule stated once in the host alignment the run's
  supply already shares: a short period whose last session is before 1 January 2000, or the week of 10 September
  2001, closes on the next bar. The other unscheduled closures since 2000 (2 January 2007, 29-30 October 2012,
  5 December 2018, 9 January 2025) fall inside a week and a month, so they end no period and no capture can read them.
- **Evidence:** A1 SPY (above) for the rule; A1 RDDT (NYSE:RDDT 1D, listed 2024) MATCH on both lanes reaches no
  early short period. Q-HTF-CAL-1a `vw-request-htf-alignment-spy-1d-2026-11-18` (AMEX:SPY 1D, 8,509 bars from the
  1993-01-29 listing) and Q-HTF-CAL-1b `vw-request-htf-alignment-qqq-1d-2026-11-18` (NASDAQ:QQQ 1D, 6,967 bars from
  1999-03-10), patrick-54's run `htfcal-2026-11-18`, packet `39001cc9653b`, our probe (licence `probe`, promoted to
  `tests/fixtures/vendor/harness/`), graded at 76: INCONCLUSIVE on both lanes as expected (the probe's `60` request is
  below the chart's timeframe); the year-by-year read is of the vendor's own columns, not a grade, and
  `tests/test_pine_htf_calendar_switch_year.py` re-derives it from the two committed captures (controls: one doctored
  week, and a start year of 1999 or 2001, each read as a break). Until the rule
  lands, a weekly or monthly request capture of a symbol whose history reaches a short period before 2000, or the week
  of 10 September 2001, is not request-other evidence unless none of its plotted values changes on such a period; the
  counted request-other captures (fair-value-gap RDDT, PA ZigZag RDDT / SPY, all the chart's own period) read no
  period at all.
- **Risk:** a wrong bar on old history only; never the newest bar. Engine number: yes (a value moves).

### U-ANCHOR `first-bar-anchor`: a running value anchored at the first bar

Added 2026-11-18 by the coordinator, measured by another session; **the 1D census cannot see it**
beyond `budget:lookback` (RDDT's history starts at its 2024 listing).
- **TradingView:** reference, `var`: the expression "will be calculated and assigned to a variable
  once", and variables declared with it "can “keep the state” despite the data updating"; a ratchet, `ta.cum`, an all-time high, an anchored
  VWAP all run from the first bar of the chart's history (the listing on a daily chart).
- **Ours today:** the host lane caps history at 960 bars (`ast/budget.js:207`, ruled not raised
  2026-11-17); a windowed value cannot reproduce a running one: SPY 1D from the 1993 listing, a level
  rising since the listing is 82% bar-equal at W=900 and 20% off at worst, while a DECAYING recurrence
  (McGinley 14) is bit-equal at W=300. The runtime lane runs from the first bar it is handed, so it is
  correct exactly when that bar is TradingView's.
- **Smallest honest change:** route a running value to the runtime lane (route-by-cost, engine 73, does
  this for cost already) and hand it the symbol's whole history on a daily chart (SPY 1D since 1993 is
  more than the 5,000 bars a chart asks for today); on intraday charts, TradingView's own history depth
  is the anchor and must be measured per timeframe.
- **Evidence:** the negative is measured (82% / 20%); missing: SPY 1D and RDDT 1D captures of an
  all-time ratchet and `ta.cum` graded MATCH on the runtime lane with full history (queue row
  Q-ANCHOR-1), and an intraday history-depth probe (Q-ANCHOR-2).
- **Risk:** bytes on first open (the history a chart fetches); a stored document's values change.
  Engine number: yes.

### U-LTF `lower-tf`: lower-timeframe requests

- **TradingView:** reference, `request.security_lower_tf`: "returns an array containing one element for
  each lower-timeframe bar within the chart bar."
- **Ours today:** `lowerTf.js:108-120` (`lower-tf:unwitnessed`, `lower-tf:lookahead`,
  `lower-tf:store-unmeasured`), `lowerTfGate.js`, `lowerTfServing.js`; the runtime lane holds no
  intraday bars (`ast/pineRuntimeFrontend.js` before `:6895`).
- **Smallest honest change:** serve the store timeframes R-LTF measured equal (price 77% of sessions
  equal, volume never), price-only first, behind the existing witness gate.
- **Evidence:** committed `vw-lower-tf`, `vw-lower-tf-1-30`, `vw-lower-tf-bars`; missing: a capture per
  served code with volume.
- **Risk:** intraday volume differs by vendor (never equal in R-LTF): a volume read is a data
  decision. Engine number: yes.

### U-BUILTIN `builtins`: names the closed table does not declare

- **TradingView:** each name is a reference entry (e.g. `timeframe.change`: "Detects changes in the
  specified `timeframe`."; `chart.fg_color`: "Returns a color providing optimal contrast with
  chart.bg_color."; `str.format`; `ticker.heikinashi`).
- **Ours today:** host `pine:builtin` / `pine:function` (`ast/pine.js` `NAMESPACE_GUARD` ~:983 and the
  closed table); runtime `runtime:call-undeclared-builtin-state` (`ast/pineRuntimeFrontend.js:8086`).
- **Smallest honest change:** one name at a time, largest first, from the token table (section 4.3);
  each name is a declared table entry plus its witness.
- **Evidence:** a capture per name grading MATCH (or a reference sentence that is an identity, as
  `hl2`). The token table is the queue.
- **Risk:** low per name; engine number per batch.
- **`ta.sar` (2026-11-18, coordinator ruling on the parity2 design).** BI1, which mapped `ta.sar(start, inc, max)`
  onto the native `sar(step, maxStep)` when start equals inc, is WITHDRAWN. The native `sar` runs the chart's own
  Parabolic SAR rules, not TradingView's `ta.sar` (`callExpansions.js::SAR_NOTE`). Its measurement, 0 of 1,039,563
  bars (`docs/pine/evidence/2026-11-16-sar-window/EVIDENCE.md`), compares a bounded window with the chart's
  full-history SAR and says nothing about TradingView. The committed parabolic-sar captures are a community script
  that computes its SAR by hand. BI1' replaces it: a runtime-lane `ta.sar` written from the Pine reference's own
  `pine_sar` code. It is served only once the built-in Parabolic SAR grades MATCH on every bar (Q-BLT-3a/b,
  `docs/pine/capture-queue-2026-11-18-parity2.md`). The host lane keeps refusing it by name.

### U-COND `conditional-history`: history of a value computed only on some bars

- **TradingView:** the history operator, reference `[]`: "Provides access to previous values of series
  expr1"; a call in a block that does not run on every bar keeps its history per call site (committed
  `vw-call-site-history`, C48; `vw-fn-history-in-if-v2..v5`, `vw-cond-window-extremes`).
- **Ours today:** `conditionalHistoryGuard` and the r4 guard (`ast/pineRuntimeFrontend.js:3227`,
  `:3299`), the lazy `?:` arm (`:3663`), drawing history (`:8610`), a call-site parameter that decides a
  branch (`:15138`). Served: `ta.sma`/`ema`/`rma` per call site and the witnessed shapes.
- **Smallest honest change:** per kernel: a call-site ring for each stateful built-in the walls name
  (the token table), each behind its capture.
- **Evidence:** C48 states the rule; each kernel needs a capture (`vw-fn-history-in-if-*` cover sma
  family). Missing: per kernel (queue rows).
- **Risk:** a value read from the every-bar column where Pine reads the call site's history (the
  silent-wrong class the guard exists for). Engine number: yes.

### U-DYN `dynamic-history`: offsets and windows known only while the bar runs

- **TradingView:** reference `[]`: "expr2 is the number of bars back, and must be numerical. Floats
  will be rounded down." `max_bars_back`: "By default, the runtime system automatically sizes the
  buffer for each series based on the script's references to past values across historical bars.";
  `indicator(max_bars_back)`: "The value must be an integer from 0 to 5000."
- **Ours today:** `runtime:history-dynamic-offset` (`ast/pineRuntimeFrontend.js:7671`, `:7776`,
  `:7833`, `:7861`, `:10037`, `:15162`): a ring width that cannot be bounded before bar 0;
  `runtime:history-expression` (`:9177`, `:10101`).
- **Smallest honest change:** size the ring from `max_bars_back` when the script declares it, else a
  measured default with a by-name refusal when a read passes it (TradingView restarts and grows; we
  refuse), never an `na` where Pine answers a number.
- **Evidence:** committed `vw-mbb-auto`, `vw-cbc-mbb-and-input`; a capture of a dynamic offset past
  500 bars (missing).
- **Risk:** memory per series; engine number: yes.

### U-STMT `statements`: statement shapes the runtime front end does not read

- **TradingView:** the language reference (if / switch / for / while as statements and values).
- **Ours today:** `runtime:statement` (101 sites, `ast/pineRuntimeFrontend.js` from `:10004`),
  `runtime:expression-statement` (`:14588`, `:14603`), `runtime:directive`, `runtime:unbound`. The
  tokens (section 4.3) name the shapes: `time(...)` in a statement position, `[` (a tuple), `color.new`,
  `array.min` / `array.max`, `ta.pivothigh` as a statement.
- **Smallest honest change:** per shape, largest first; most are lowering gaps, not semantics.
- **Evidence:** each shape's scripts graded MATCH once lowered (the f-imp / f2-imp captures, 11-17,
  local, cover the imperative-only scripts).
- **Risk:** low; engine number per batch.

### U-FGS `function-global-state`: a function body reading a mutable global

- **TradingView:** a user function reads a global variable's current value (User Manual,
  "Declaring functions"); committed `vw-udt-fn-global-history`.
- **Ours today:** `ast/pineRuntimeFrontend.js:8872` (a name the frame cannot address), `:9194`,
  `:10105`, `:10231` (a windowed built-in over a global).
- **Smallest honest change:** give the frame an address for a global's slot (read-only), and a
  windowed built-in over it the global's own ring.
- **Evidence:** `vw-udt-fn-global-history` (committed); a capture of a windowed built-in over a global
  inside a function (missing).
- **Risk:** a global read before it is written on the bar (ordering); engine number: yes.

### U-FN `functions`: user-defined function shapes and methods

- **TradingView:** reference `=>`: "The '=>' operator is used in user-defined function declarations";
  `method`: "can then be invoked using dot notation".
- **Ours today:** `runtime:function` (`ast/pineRuntimeFrontend.js:2782`-`:2829`, `:14653`-`:14996`),
  `runtime:udt-method` (`:1999`-`:2205`, `:13460`), `runtime:recursion` (Pine forbids it).
- **Smallest honest change:** per shape named in the token table; `method-def` admission is its own
  evidence unit.
- **Evidence:** per shape, a capture.
- **Risk:** call-site frames (history per call): engine number: yes.

### U-BLOCK `block-value`: if / switch used as a value

- **TradingView:** reference `switch`: "If the result of the switch statement is assigned to a variable
  and a default_local_block is not specified, the statement returns na if no local_block is executed."
- **Ours today:** `runtime:block-value` (`ast/pineRuntimeFrontend.js:11523`-`:12228`), `runtime:tuple`
  (`:13757`, `:13814`).
- **Smallest honest change:** the remaining shapes (a tuple-valued arm; a block whose last statement is
  not an expression).
- **Evidence:** a capture per shape (missing).
- **Risk:** low; engine number: yes.

### U-LOOP `loops`

- **TradingView:** reference `for...in`: "Scripts can modify the sizes of arrays and matrices while
  iterating over their contents ... they cannot modify the sizes of maps while looping over them".
- **Ours today:** `runtime:loop` (`ast/pineRuntimeFrontend.js:12919`, `:13574`, `:13666`); engine 69
  served the live-list `for … in`; reverse / sort / fill / concat inside the loop stay refused.
- **Smallest honest change:** the remaining mutations, each behind `vw-forin-collections-2`-style rows.
- **Evidence:** committed `vw-forin-collections`, `-2`, `vw-h4-loops`, `vw-loop-in-block`.
- **Risk:** low; engine number: yes.

### U-STATECALL `state-calls`: built-ins fed by a mutable value

- **Ours today:** `runtime:call-windowed-state`, `-text-state`, `-conversion-state`, `runtime:input-state`,
  `runtime:builtin-args` (`ast/pineRuntimeFrontend.js:288`-`:316`, `:8074`-`:8088`, `:9721`).
- **Smallest honest change:** the series bridge for a windowed built-in over a `var` (the ring the
  history unit builds), text/conversion as pointwise applies.
- **Evidence / risk:** a capture per kernel; engine number: yes.

### U-COLOUR `colour`: colour and text as computed values

- **TradingView:** reference `color`: "Color literals have the following format: #RRGGBB or #RRGGBBAA."
- **Ours today:** `runtime:colour` (`ast/pineRuntimeFrontend.js:2978`, `:8955`, `:11065`-`:11259`):
  served only where kind and value are certain; `runtime:fill-target` (`:11200`).
- **Smallest honest change:** type the remaining colour flows (a colour through a function return, an
  array of colours) so the packed integer is never a price.
- **Evidence:** committed `vw-rt6-runtime-colour`, `vw-gradient`; per shape (missing).
- **Risk:** low; engine number: yes.

### U-COLL `collections`, U-TYPES `types`, U-RT `realtime`, U-OUT `output-contract`, U-CALL `call-mapping`,
### U-IMP-HOST `imperative-host`, U-ROB `robustness`, U-DET `detector`, U-BUDGET `compute-budget`, U-LISTS `known-lists`

Smaller families, each named by its wall in section 4:
- **collections:** `runtime:array` (`ast/pineRuntimeFrontend.js:2116`, `:5950`, `:9909`, `:14528`): a
  `matrix.*` / `map.*` / `array.*` member the lane lacks. Reference: `matrix.new<type>`, `map.new`.
  Engine number: yes. Admission of `collections:matrix` / `collections:map` is its own evidence unit.
- **types:** `runtime:enum` (`:5364`), `runtime:udt` / `-field` (`:13416`, `:10724`). Reference `enum`:
  "Enums are unique constructs that hold groups of predefined constants."
- **realtime:** `runtime:varip` (`:13505`, `:14218`). Reference `varip`: "variables ... retain their
  values between executions of the script on the same bar." On closed historical bars a `varip` is a
  `var`; serving that (scope: closed bars, as `realtime-state`) is evidence plus the frame rule.
- **output-contract:** `runtime:no-output` (`:15932`) and the host's constant-only / presentation-only:
  a script whose output the pane does not carry (hidden plots, `display.none`, constant plots).
- **call-mapping:** `pine:arity` / `pine:input-kind` on the host: a known name's call shape.
- **imperative-host:** host `pine:state` / `pine:block` steps the runtime lane names nothing for (the
  peel reached them on the host).
- **robustness:** `runtime:lower` (`runtime/runtimeColumns.js:132`, `:1730`, `:1817`): lowering threw.
- **detector:** `admission:unreadable`: `pine_capabilities.capabilities_of` cannot read the source (the
  repaint classifier fails), so admission fails closed. A detector fix, no engine number.
- **compute-budget:** `budget:lookback` / `-series` / `-nodes` (`ast/budget.js:207`-`:221`). Ruled
  11-17 on measurement: no cap is raised (`docs/pine/evidence/2026-11-17-compute-caps/EVIDENCE.md`);
  route-by-cost (#1711) is the path.
- **known-lists:** `runtime:kill-list` / `[known-divergence]`: a script whose committed capture
  grades DIVERGE, refused by name until the engine fix re-grades it MATCH; each is its own fix.
  Each listing's owner, measured 2026-11-18 on the parity2 design. Coordinator ruling: no known-lists fix (KL1 /
  KL2) is built on its own, because every listing is held by another unit's wall; each comes off its list when
  that unit's fix re-grades its capture MATCH.

  | listing | what holds it on the host lane | where its run stops | owner |
  |---|---|---|---|
  | `heat-map-seasons` | the gauge cell's background and the `barcolor` are `color.from_gradient` over `ta.highest` / `ta.lowest` in a `?:` arm (`fn:conditional-history`), so the cell is dropped (TradingView 31 cells, ours 30) | `runtime:call-undeclared-builtin-state` (`ta.correlation` fed by a mutable value) | U-COND (and state-calls for the run) |
  | `position-size-calc` | the dropped cell's text is a lot size computed from an FX `request.security` and `syminfo.basecurrency` | builds | U-REQ |
  | `vold-market-breadth` | reads breadth symbols (USI) | `runtime:input-state` | data decision |
  | `ema-ribbon-trend-filter-strixedge` | its cell texts read `request.*` and built-ins the host does not declare | `lower-tf:store-unmeasured` | request / builtins (lower-tf for the run) |
  | `artemis-oscillator-pro` | 5 reassigned cell texts | `runtime:call-windowed-state` (`ta.percentile_linear_interpolation` fed by a mutable value) | statements / call-windowed-state |
  | `htf-candle-footprint-cartel-console` | its labels and lines are created from user types (`pine:type`) | `pine:function` `color` (a `color(x)` call: BI2) | types |
  | `htf-liquidity-dashboard-tfo` | its cells read collections and state | `pine:request` (`ES1!`, a continuous future) | request |
  | `momentum-based-zigzag` | `runtime:kill-list` | listed | HIST-K2 |
  | `average-day-range-adr-pivots` | a global reassigned inside a function (`pine:state`); its SPY DIVERGE (a line's x2) is not yet read | `runtime:request` (`lookahead`) | U-REQ (`lookahead`) |
  | `contraction-box-doji-lines` | no longer listed on master | builds | freed |

  KL3 (`text_font_family`, artemis's cell (0,0)) is DEFERRED as a later parity nicety: it lifts no listing on its
  own.

### Evidence units `admit:<capability>`

Each is a registry row in `api/data/pine_runtime_allowlist.json` (`capabilities`), admitted by
`rollout_gate.pine_capability_admission` on 2 runtime-on MATCH captures from 2 scripts with at least
one community script (objects: objects-v2 MATCH and no x DIVERGE). No engine change, no engine number.

## 6. What we never serve (and what is a data decision)

"Everything Pine can do" is measured against what is possible. The classes below need data we do not
hold. No engine work serves them, and a script that needs one can never transfer fully. Each class is
listed with the refusal the engine gives today. Matching uses each not-served script's facts: the reference
items it uses that `coverage_map.DATA_LIMITED` names, the Pine names its walls stop on, the exchanges its
`request.security` / `input.symbol` literals name, and the `other-symbol:*` codes its census rows carry. A
symbol reached through a variable is not seen, so these counts are a floor.

| class | scripts | refusal today | scripts (corpus slug) |
|---|---:|---|---|
| fundamentals | 3 | host `pine:request` (`request` namespace guard) or `pine:builtin` (syminfo.*); runtime `runtime:request-with-state` / `runtime:request`; `other-symbol:seed-unregistered` / `other-symbol:venue-foreign` | `builtin:price-target`, `reference:earnings-sr-levels-lazybear`, `reference:my-cme-open-interest` |
| footprint-ticks | 2 | host `pine:request` / `pine:builtin` / `pine:type` (footprint); runtime `runtime:request`; `lower-tf:unwitnessed` for a seconds timeframe | `builtin:24-hour-volume`, `reference:lorentzian-classification-advanced-trading-dashboard` |
| other-feeds | 8 | host `pine:request` with `other-symbol:venue-foreign` or `other-symbol:bare`; runtime `runtime:request-with-state` / `runtime:request` | `builtin:24-hour-volume`, `committed:supertrend-explorer` (ruled by name), `committed:volume-spikes-growing-volume-signals-with-alerts-scanner`, `reference:cobra039s-crypto-market-visualizer`, `reference:custom-screener-with-alerts` (ruled by name), `reference:divergence-stack-scanner-agpro-series`, `reference:halftrend-longshort-signal-engine-bigbeluga`, `reference:screener-for-40-instruments` (ruled by name) |
| broker | 2 | none at the door: the alert text is a string; the order it would place is the broker's | `committed:atr-god-strategy-by-tradesmart`, `committed:rsi-vwap-indicator` |
| breadth | 1 | host `pine:request` with `other-symbol:venue-foreign` / `other-symbol:class-share` on a USI: spelling | `committed:4c-nyse-market-breadth-ratio` |
| indices | 1 | `other-symbol:witness-pending` / `other-symbol:venue-foreign` | `committed:sub` |
| corporate-events | 4 | host `pine:request` / `pine:builtin`; runtime `runtime:request-with-state` | `builtin:volume-weighted-average-price`, `committed:black-scholes-option-pricing-model-w-greeks-loxx`, `reference:earnings-sr-levels-lazybear`, `reference:vwap-trendfollow-strategy-wbburgin` |

- **Ruled never-serve by name (coordinator, 2026-11-18, PARITY UNIT 1):** `committed:supertrend-explorer`,
  `reference:custom-screener-with-alerts` and `reference:screener-for-40-instruments` read crypto pairs as symbol
  input defaults (a v4 `input('BINANCE:EOSBTC', title=input.symbol)`; bare `XRPUSDT`-style pairs) that the facts
  hold no venue for, so no detector above classed them, and the `objects` unit asked a capture of each (Q-OBJ1-3).
  TradingView itself refuses every one at its defaults ("Invalid symbol"; capture run objunit-2026-11-18, packet
  `582f2cf1e50b7fbb1939bf9d4fd38017981ac9d4c5aeb290f3add37703ccf596`, 0 of 6 capturable, as on 2026-11-15), and we
  hold no crypto data: `other-feeds`, by name (`parity_roadmap.RULED_NEVER_SERVE`, each with its witness in
  `parity-roadmap.json` `neverServe[].ruledByName`). `parity-roadmap.json` is rebuilt with them; the tables of this
  document were written before the ruling, and the JSON is the authority: `objects` sole servable 44 -> 41
  (unlocks 41, served after 316 of 679, 46.5%), and every later cumulative "served after" count 3 lower.
- **Never-serve (removed from the ranking):** `fundamentals`, `footprint-ticks` and `other-feeds`, 12
  distinct scripts (one is in two classes; 9 before the ruling above). `broker` is a feature class (an alert whose message drives a connected brokerage). We simulate
  orders, we never route them, and those scripts stay in the ranking for their chart output.
- **Data decisions (in scope as data, not engine):** `breadth` (our own breadth data serving USI:
  spellings), `indices` (one spelling at a time behind a capture witness, as SP:SPX), `corporate-events`
  (earnings / dividends / splits as TradingView serves them). These scripts are held out of the engine
  ranking: the data unit is what frees them.
- The reference spells the limits out: `bid`: "This information is available only on the "1T" timeframe";
  `request.footprint`: "Only accounts with Premium or Ultimate plans can use scripts that call this
  function"; `request.economic`: "Economic data includes information such as the state of a country's
  economy (GDP, inflation rate, etc.)"; `request.seed`: "The creation of new Pine Seeds repositories is
  suspended".

## 7. The build order

Ranked by members' scripts unlocked per unit of work. The greedy rule:
- each step builds the unit whose completion frees the most scripts for its size: sole scripts first,
  and in later steps the pairs it closes with units already built;
- a unit is never built before the units it stands on (`DEPENDS`: libraries are exported user functions,
  globals and types, so `functions`, `function-global-state` and `types` come first);
- never-serve scripts are left out;
- the owner-gated `strategy` unit is held apart: 70 strategies, 45 with it as their only
  unit;
- the 4 data-decision scripts (section 6) are held apart: their data unit frees them, not engine
  work.

**The sizes are ESTIMATES** (S=1, M=2, L=4), stated in `parity_roadmap.UNIT_SIZE`. They only order units
of similar reach. The unlock counts are measured; "fully enumerated" is their firm part.

| # | unit | kind | size | unlocks | unlocks per size | of them fully enumerated | served after (of 679) |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | `objects` | engine | 4 | 44 | 11.0 | 44 | 319 (47.0%) |
| 2 | `known-lists` | engine | 2 | 10 | 5.0 | 10 | 329 (48.5%) |
| 3 | `admit:obj:linefill` | evidence | 1 | 4 | 4.0 | 4 | 333 (49.0%) |
| 4 | `output-contract` | engine | 2 | 6 | 3.0 | 2 | 339 (49.9%) |
| 5 | `dynamic-history` | engine | 2 | 8 | 4.0 | 2 | 347 (51.1%) |
| 6 | `builtins` | engine | 4 | 14 | 3.5 | 10 | 361 (53.2%) |
| 7 | `admit:request-other` | evidence | 1 | 8 | 8.0 | 4 | 369 (54.3%) |
| 8 | `request` | engine | 2 | 22 | 11.0 | 11 | 391 (57.6%) |
| 9 | `request-with-state` | engine | 2 | 16 | 8.0 | 11 | 407 (59.9%) |
| 10 | `statements` | engine | 2 | 15 | 7.5 | 7 | 422 (62.2%) |
| 11 | `colour` | engine | 1 | 9 | 9.0 | 4 | 431 (63.5%) |
| 12 | `conditional-history` | engine | 2 | 16 | 8.0 | 6 | 447 (65.8%) |
| 13 | `function-global-state` | engine | 2 | 8 | 4.0 | 4 | 455 (67.0%) |
| 14 | `functions` | engine | 2 | 3 | 1.5 | 0 | 458 (67.5%) |
| 15 | `types` | engine | 2 | 1 | 0.5 | 0 | 459 (67.6%) |
| 16 | `libraries` | engine | 4 | 33 | 8.25 | 9 | 492 (72.5%) |
| 17 | `admit:method-def` | evidence | 1 | 8 | 8.0 | 3 | 500 (73.6%) |
| 18 | `loops` | engine | 1 | 6 | 6.0 | 5 | 506 (74.5%) |
| 19 | `robustness` | engine | 1 | 6 | 6.0 | 0 | 512 (75.4%) |
| 20 | `admit:collections:matrix` | evidence | 1 | 5 | 5.0 | 2 | 517 (76.1%) |
| 21 | `imperative-host` | engine | 1 | 5 | 5.0 | 3 | 522 (76.9%) |
| 22 | `state-calls` | engine | 2 | 9 | 4.5 | 2 | 531 (78.2%) |
| 23 | `lower-tf` | engine | 2 | 10 | 5.0 | 4 | 541 (79.7%) |
| 24 | `detector` | engine | 1 | 5 | 5.0 | 1 | 546 (80.4%) |
| 25 | `call-mapping` | engine | 1 | 6 | 6.0 | 2 | 552 (81.3%) |
| 26 | `block-value` | engine | 2 | 9 | 4.5 | 2 | 561 (82.6%) |
| 27 | `admit:calc-bars` | evidence | 1 | 4 | 4.0 | 1 | 565 (83.2%) |
| 28 | `admit:obj:polyline` | evidence | 1 | 5 | 5.0 | 0 | 570 (83.9%) |
| 29 | `admit:collections:map` | evidence | 1 | 4 | 4.0 | 0 | 574 (84.5%) |
| 30 | `collections` | engine | 2 | 8 | 4.0 | 3 | 582 (85.7%) |
| 31 | `admit:enum` | evidence | 1 | 4 | 4.0 | 0 | 586 (86.3%) |
| 32 | `admit:varip` | evidence | 1 | 3 | 3.0 | 3 | 589 (86.7%) |
| 33 | `compute-budget` | engine | 2 | 4 | 2.0 | 2 | 593 (87.3%) |
| 34 | `realtime` | engine | 2 | 3 | 1.5 | 0 | 596 (87.8%) |

**The order I would build, and why it differs where it does.**

The greedy order is the measurement. I would build it with four changes, each for a reason the
counts cannot carry:

1. **Run the evidence units now, in parallel with engine work.** They need no engine number, only a
   registry row in `api/data/pine_runtime_allowlist.json` on MATCH captures. Some already have a
   runtime-drawn sample script with a committed runtime-on MATCH (`runtimeDrawnWithMatch` in the JSON):
   - `admit:obj:linefill` (sole 4): `fvg-detector-tradingfinder-…` and `trend-targets-algoalpha`;
   - `admit:collections:matrix` (sole 2): `one-sided-gaussian-support-resistance-rate-loxx`;
   - `admit:calc-bars` (sole 1): `wyckoff-accumulation-distribution`;
   - `admit:request-other` (sole 1, but in front of 130 scripts): `fair-value-gap`.
   The rule is 2 MATCH captures from 2 scripts, at least one a community script. `admit:obj:linefill` may
   already meet it (two community scripts), with their objects-v2 grades on the record, as every `obj:*`
   row needs. The others need one more capture each, not an engine change.
2. **`objects` first among engine units, but measure before building.** Its 44 sole scripts are HOST
   documents that attach dirty; the door never offers them to the runtime lane, so no census row says
   whether that lane would draw them.
   - The first step is an instrument change, no engine number: probe the runtime lane on attached-dirty
     rows.
   - Then route (a), the route-by-cost pattern, for the ones it draws the same.
   - Then route (b), the host drop heads, largest first, for the rest.
   - The 44 is an upper bound until the probe runs.
3. **The request family after `admit:request-other`.** Order: `request` (22 at its turn), then
   `request-with-state` (16), then `lower-tf` (10). U-DAILY rides `request`: the capability census
   counts previous-day levels among the most-asked intraday reads. The data decisions (breadth, indices,
   corporate events) free the rest of `request`'s scripts, and need the owner's data calls, not engine
   work.
4. **Libraries are large but the biggest single tail** (33 scripts at their turn; 65 touched). They wait
   for `function-global-state`, `functions` and `types`, as `DEPENDS` orders it.
   - The first version to link is the TradingView-published `TradingView/ZigZag/7`, imported by built-ins.
   - Each version is admitted on its own evidence (U15).
   - A non-commercial licence is never served.

The rest follow the table. Two more placements:
- `known-lists` (10) is not a unit of its own. Each listed script comes off its list when the unit that
  fixes its engine gap re-grades its capture MATCH, so it follows the units it pairs with (8 of 10 pair
  with `objects`).
- U-ANCHOR belongs with route-by-cost: route a running value to the runtime lane, and hand that lane the
  symbol's whole history on a daily chart.

**Dependencies, stated once:**
- user functions, globals and types before libraries;
- `admit:request-other` before any request unit reaches a member;
- the census probe on attached-dirty rows before `objects` route (a);
- `conditional-history` before the `builtins` names that are stateful (`timeframe.change`, `ta.swma`
  over a mutable value);
- the strategy registry row (owner) before any strategy.

### 7.1 Evidence status per unit, and the capture queue

Per unit, the evidence today of its sole scripts that no data wall stops:
- committed MATCH: a committed capture grading runtime-on MATCH;
- committed other: committed captures, none MATCH runtime-on;
- ledger only: licence-held rows in `evidence-ledger.jsonl`, graded out of git at the engine each row records;
- local only: tonight's f-imp / f2-imp and other local runs, not in the ledger (patrick-54 promotes them
  at e73);
- none: no capture anywhere.

| unit | kind | size | sole | sole, enumerated | any | sole scripts' evidence: committed MATCH / committed other / ledger only / local only / none |
|---|---|---:|---:|---:|---:|---|
| `objects` | engine | 4 | 45 | 45 | 75 | 5 / 7 / 29 / 0 / 3 |
| `strategy` | owner | 4 | 45 | 22 | 70 | 2 / 3 / 0 / 0 / 40 |
| `builtins` | engine | 4 | 11 | 9 | 157 | 0 / 3 / 8 / 0 / 0 |
| `statements` | engine | 2 | 4 | 2 | 64 | 0 / 3 / 1 / 0 / 0 |
| `dynamic-history` | engine | 2 | 4 | 2 | 38 | 0 / 1 / 3 / 0 / 0 |
| `conditional-history` | engine | 2 | 4 | 3 | 31 | 0 / 1 / 3 / 0 / 0 |
| `output-contract` | engine | 2 | 4 | 0 | 31 | 0 / 1 / 3 / 0 / 0 |
| `admit:obj:linefill` | evidence | 1 | 4 | 4 | 19 | 2 / 0 / 2 / 0 / 0 |
| `libraries` | engine | 4 | 3 | 3 | 65 | 0 / 2 / 1 / 0 / 0 |
| `colour` | engine | 1 | 3 | 2 | 21 | 0 / 2 / 1 / 0 / 0 |
| `function-global-state` | engine | 2 | 3 | 1 | 14 | 0 / 1 / 2 / 0 / 0 |
| `admit:collections:matrix` | evidence | 1 | 2 | 2 | 10 | 1 / 0 / 1 / 0 / 0 |
| `known-lists` | engine | 2 | 2 | 2 | 10 | 1 / 1 / 0 / 0 / 0 |
| `compute-budget` | engine | 2 | 2 | 1 | 6 | 0 / 0 / 0 / 1 / 1 |
| `admit:request-other` | evidence | 1 | 1 | 1 | 130 | 1 / 0 / 0 / 0 / 0 |
| `admit:method-def` | evidence | 1 | 1 | 1 | 25 | 0 / 1 / 0 / 0 / 0 |
| `state-calls` | engine | 2 | 1 | 1 | 14 | 0 / 0 / 0 / 0 / 1 |
| `loops` | engine | 1 | 1 | 1 | 11 | 0 / 0 / 1 / 0 / 0 |
| `admit:calc-bars` | evidence | 1 | 1 | 1 | 9 | 1 / 0 / 0 / 0 / 0 |
| `robustness` | engine | 1 | 1 | 0 | 7 | 0 / 0 / 1 / 0 / 0 |
| `admit:varip` | evidence | 1 | 1 | 1 | 6 | 0 / 1 / 0 / 0 / 0 |
| `request` | engine | 2 | 0 | 0 | 51 | 0 / 0 / 0 / 0 / 0 |
| `request-with-state` | engine | 2 | 0 | 0 | 39 | 0 / 0 / 0 / 0 / 0 |
| `functions` | engine | 2 | 0 | 0 | 16 | 0 / 0 / 0 / 0 / 0 |
| `lower-tf` | engine | 2 | 0 | 0 | 14 | 0 / 0 / 0 / 0 / 0 |
| `block-value` | engine | 2 | 0 | 0 | 12 | 0 / 0 / 0 / 0 / 0 |
| `types` | engine | 2 | 0 | 0 | 11 | 0 / 0 / 0 / 0 / 0 |
| `admit:obj:polyline` | evidence | 1 | 0 | 0 | 9 | 0 / 0 / 0 / 0 / 0 |
| `collections` | engine | 2 | 0 | 0 | 9 | 0 / 0 / 0 / 0 / 0 |
| `admit:collections:map` | evidence | 1 | 0 | 0 | 8 | 0 / 0 / 0 / 0 / 0 |
| `call-mapping` | engine | 1 | 0 | 0 | 7 | 0 / 0 / 0 / 0 / 0 |
| `detector` | engine | 1 | 0 | 0 | 7 | 0 / 0 / 0 / 0 / 0 |
| `imperative-host` | engine | 1 | 0 | 0 | 6 | 0 / 0 / 0 / 0 / 0 |
| `admit:enum` | evidence | 1 | 0 | 0 | 4 | 0 / 0 / 0 / 0 / 0 |
| `realtime` | engine | 2 | 0 | 0 | 3 | 0 / 0 / 0 / 0 / 0 |

The queue rows for the first units of the order are below. Every row without a capture is a new pair on
NYSE:RDDT 1D + AMEX:SPY 1D, the coordinator's convention. The JSON (`units[].evidence.queue`) holds every
unit's rows.

| unit | script (corpus slug) | evidence today | capture row |
|---|---|---|---|
| `builtins` | `builtin:moon-phases` | ledgerOnly | ledger row only: re-grade at e73 |
| `builtins` | `builtin:visible-average-price` | ledgerOnly | ledger row only: re-grade at e73 |
| `builtins` | `committed:previous-day-high-and-low-separators-dailyweekly` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `builtins` | `committed:trend-levels-chartprime` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `builtins` | `committed:volume-profile-auto-line-v2` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `builtins` | `reference:cm-forex-sessions-highlight-v1` | ledgerOnly | ledger row only: re-grade at e73 |
| `builtins` | `reference:fvg-instantaneous-mitigation-signals-luxalgo` | ledgerOnly | ledger row only: re-grade at e73 |
| `builtins` | `reference:rsi-entry-engine-trade-w-samet` | ledgerOnly | ledger row only: re-grade at e73 |
| `builtins` | `reference:rsi-kernel-optimized-flux-charts` | ledgerOnly | ledger row only: re-grade at e73 |
| `builtins` | `reference:squeeze-momentum-indicator-lazybear-vx-by-dgt` | ledgerOnly | ledger row only: re-grade at e73 |
| `builtins` | `reference:vp-period` | ledgerOnly | ledger row only: re-grade at e73 |
| `dynamic-history` | `committed:nubia-auto-midas-anchored-vwap-xdecow` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `dynamic-history` | `reference:range-filter-v1` | ledgerOnly | ledger row only: re-grade at e73 |
| `dynamic-history` | `reference:rsi-cyclic-smoothed` | ledgerOnly | ledger row only: re-grade at e73 |
| `dynamic-history` | `reference:smc-target-liquidity-v35-manual-distance-control` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `builtin:multi-time-period-charts` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `committed:auto-trendline-dojiemoji` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `objects` | `committed:dual-view-htf-candlestick-patterns-theultimator5` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `objects` | `committed:liquidity-heatmap-nephew-sam` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `objects` | `committed:multicator-table` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `objects` | `committed:sector-rotation` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `objects` | `committed:supertrend-explorer` | none | WITHDRAWN 2026-11-18: never-serve `other-feeds`, ruled by name (TradingView refuses it at its defaults, "Invalid symbol"; section 6) |
| `objects` | `committed:trend-lines-supports-and-resistances` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `objects` | `committed:volume-profile` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `objects` | `reference:auto-trendlines-by-pivots-perfect-non-repainting-lines-spyqqq-daily-pr` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:crypto-correlation-matrix` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:cryptosignalscanner-rsi-overboughtoversold-divergence-indicator-new` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:custom-screener-with-alerts` | none | WITHDRAWN 2026-11-18: never-serve `other-feeds`, ruled by name (TradingView refuses it at its defaults, "Invalid symbol"; section 6) |
| `objects` | `reference:dot-dynamics` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:dual-supertrend-ichimoku-and-dmi-color-weighted-by-dgt` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:dynamic-higher-timeframe-fibonacci-pivot-points` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:dynamic-linear-regression-channels` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:fabio-style-order-flow-lvn-volumeprofile-fvgob-liquiditygrabs-dashboar` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:fibonacci-extention-retracment-pivot-points-by-dgt` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:fourier-extrapolator-of-price-w-projection-forecast-loxx` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:intraday-power-3-visual` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:linear-regression-channel-curve-slope-by-dgt` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:liquidity-heatmap-swiftedge` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:liquidity-sniper-pro` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:liquidity-swings-luxalgo` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:machine-learning-random-forest-strategy-gainzalgo` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:market-trend-levels-detector-bigbeluga` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:onchart-wavetrend-divergence-with-pivots` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:range-filter-x-hull-suite` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:relative-strength-index-divergences-libertus` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:rsi-support-resistance-by-dgt` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:screener-for-40-instruments` | none | WITHDRAWN 2026-11-18: never-serve `other-feeds`, ruled by name (TradingView refuses it at its defaults, "Invalid symbol"; section 6) |
| `objects` | `reference:smart-money-concepts-probability-expo` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:support-and-resistance-step-4` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:support-and-resistance` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:support-resistance-fibonacci-retracement` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:trend-channels-with-liquidity-breaks-chartprime` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:trend-direction-helper` | ledgerOnly | ledger row only: re-grade at e73 |
| `objects` | `reference:zig-zag-channels-luxalgo` | ledgerOnly | ledger row only: re-grade at e73 |
| `output-contract` | `builtin:bollinger-bars` | ledgerOnly | ledger row only: re-grade at e73 |
| `output-contract` | `builtin:chop-zone` | ledgerOnly | ledger row only: re-grade at e73 |
| `output-contract` | `committed:nonlinear-regression-zero-lag-moving-average-loxx` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `output-contract` | `reference:coral-trend-indicator-lazybear` | ledgerOnly | ledger row only: re-grade at e73 |
| `known-lists` | `committed:momentum-based-zigzag` | committedOther | committed, not runtime-on MATCH: re-grade after the unit |
| `admit:obj:linefill` | `builtin:linear-regression-channel` | ledgerOnly | ledger row only: re-grade at e73 |
| `admit:obj:linefill` | `reference:best-sr-indicator-with-candlestick-patterns` | ledgerOnly | ledger row only: re-grade at e73 |

Probe rows this page adds (no sample script stands for them):
- **Q-DAILY-1:** previous day H/L/C and floor pivots on SPY and RDDT, 5 and 15 minutes.
- **Q-ANCHOR-1:** an all-time ratchet and `ta.cum` on SPY 1D and RDDT 1D, from the listing.
- **Q-ANCHOR-2:** TradingView's history depth per intraday timeframe.
- **Q-REQ-OTHER-1:** two community scripts the runtime lane draws that request another context, graded
  runtime-on MATCH, to admit `request-other`. ⚠️ Coordinator ruling 2026-11-18: an identity-only request does not
  bind for admission. `reference:intraday-power-3-visual` and `reference:support-resistance-fibonacci-retracement`
  (both drawn by the run half since PARITY UNIT 1, their 1D captures MATCH) read the chart's own symbol and, at
  their defaults on a daily chart, its own timeframe: they do not count toward this row.
- **Q-DAILY-2** (U-DAILY, part of U-REQ; for when lower-timeframe charts are in scope): `reference:intraday-power-3-
  visual` on AMEX:SPY 5m and NYSE:RDDT 5m, at its default (`D`) and at its weekly option (`W`): its four
  `request.security` reads of the chart's own symbol at a higher timeframe the intraday chart does not hold. The
  binding capture; its 1D captures witness only the identity case.
- **Q-FCMP3-1 / -2: READ 2026-11-18, flag off.** Captured as run `fcmp3b-2026-11-18`, packet `b400024aa71d`
  (committed):
  `tools/visual_conformance/probes/vw-fcmp-arrays.pine` on AMEX:SPY 1D from the listing and NYSE:RDDT 1D.
  - `array.lastindexof` reads TOLERANT, and moves onto `pineCompare.js` (engine 81,
    `feat/pine-tolerant-lastindexof`).
  - `array.binary_search` / `_leftmost` / `_rightmost` read EXACT, and stay exact (now pinned).
  - Readings: `docs/pine/capture-queue-2026-11-18-float-tolerance-form.md`, section Q-FCMP3.

## 8. The machine twin and its rail

- `docs/pine/parity-roadmap.json` (`uct.pine-parity-roadmap/v1`), written by
  `tools/pine_coverage/parity_roadmap.py build` from `docs/pine/coverage-map.json` (regenerated in this
  PR at engine 73) and a `facts` block measured locally by `parity_roadmap.py facts`: per script not
  served on the host lane, its admission answer, the Pine names its runtime walls stop on (a script's own
  identifiers are not kept), the exchanges its request literals name, its committed capture ids and
  verdicts, its evidence-ledger rows and the local capture runs that hold it (run ids only). Identifiers
  only: no source, no message text.
  - wall -> counts and scripts: `memberWalls` (every wall: sole, sole fully enumerated, any, the sole
    scripts), `memberPairs`, `hostLane` (blockers with sole scripts, buckets, pairs),
    `hostSoleRuntimeWalls`;
  - unit -> counts, scripts and evidence status: `units` (sole, servable, any, `evidence.counts`, the
    `evidence.queue` rows), `unitPairs`, `buildOrder`;
  - `neverServe` / `dataDecisions`: class -> scripts; `scripts`: key -> walls.
- **The rail:** `tests/test_pine_parity_roadmap.py`. It re-derives every section from the committed map
  and the committed facts and fails on any difference (a re-measured map that moves a wall, or a hand
  edit), with controls that make it fail both ways; it re-reads the facts of the committed corpus
  scripts from their committed sources (the server's detector against the facts' registry snapshot);
  and it fails when a wall maps to no unit.
- **Why the census itself does not run in CI.** 413 of the 679 sample scripts (271 reference, 142
  built-in) are licence-held sources in the local sample cache; the repo is public and they are never
  committed or sent to CI. So the door cannot be re-run over the sample on GitHub. CI re-derives the
  roadmap from the census OUTPUT the map commits (and the coverage ratchet keeps re-running the door
  over the committed half). To re-check progress: re-run the census (section 9's commands), regenerate
  the map, then `parity_roadmap.py facts` and `build`; the rail then holds the new numbers.

## 9. How it was measured

The worktree was at `99de72e7c0e558dc429d18706b1da313cce0ba95` (`origin/master`,
`SCRIPT_ENGINE_VERSION = 73`). `git rev-parse HEAD` was identical before and after every lane. Each lane
took the heavy lock separately, `VITEST_MAX_WORKERS=1`, node v24.13.1. The run waited for patrick-54's
e73 promote to release the lock first, as the coordinator ordered. `$O` is a scratch directory outside
the repo. `$O/prod` and `$O/rt` are fresh copies of the sample cache: `sample_manifest.json` is
byte-identical to the one 11-16 and 11-17 used (sha256 `bfdf7ea4…`), with 679 `ok` rows and 3 built-ins
`closed_no_auth`. `$REF` is the same `ref_rebuilt.json`. The commands are 11-17's, unchanged:

```sh
L="python C:/Users/Patrick/uct-clips/tools/heavy_lock.py --timeout 14400"
$L --label census-production-e73-roadmap run -- python tools/pine_coverage/run_census.py --cache $O/prod --ref $REF
$L --label census-runtime-on-e73-roadmap run -- python tools/pine_coverage/run_census.py --runtime-on --cache $O/rt --ref $REF
# from app/
VENDOR_HARNESS_RUNTIME_ON=0 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/verdicts-prod \
  $L --label census-harness-production-e73-roadmap run -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=1
VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/verdicts-rt \
  $L --label census-harness-runtime-on-e73-roadmap run -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=1
COVERAGE_DOOR_OUT=$O/engine_door.json $L --label census-engine-door-e73-roadmap run -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js --maxWorkers=1
# the map
python tools/pine_coverage/coverage_map.py --cache $O/prod --ref $REF \
  --verdicts $O/verdicts-prod/verdicts.json --runtime-cache $O/rt --runtime-verdicts $O/verdicts-rt/verdicts.json \
  --engine-door $O/engine_door.json --out docs/pine/coverage-map.json --measured-on 2026-11-18 --master-sha 99de72e7c0
# the roadmap: facts (local), then build (committed inputs only), then the rail
python tools/pine_coverage/parity_roadmap.py facts --ref $REF --names-ref <the whole v6 reference extract> \
  --cache $O/prod --runtime-cache $O/rt --verdicts $O/verdicts-prod/verdicts.json \
  --runtime-verdicts $O/verdicts-rt/verdicts.json --local-runs %LOCALAPPDATA%/uct-vendor-batch/runs --out $O/facts.json
python tools/pine_coverage/parity_roadmap.py build --facts $O/facts.json
python tools/pine_coverage/parity_roadmap.py check
```

Results of each run:

| run | result |
|---|---|
| census, production | 967 / 967 rows, 0 killed, 1 attempt; `LANE MEASURED: production (gate CLOSED, runtime lane reached 0, host refusals 1209)`; vitest 26 passed, 1 skipped; 14.9 min |
| census, runtime-on | 967 / 967 rows, 0 killed, 1 attempt; `LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 1855, host refusals 1654)`; vitest 26 passed, 1 skipped; 9.8 min |
| harness, production | 1 file passed, 11 tests passed; 837 captures graded: MATCH 188, DIVERGE 74, INCONCLUSIVE 575; 5.5 min |
| harness, runtime-on | 1 file passed, 11 tests passed; 837 captures graded: MATCH 285, DIVERGE 67, INCONCLUSIVE 465, MATCH_SUBSTITUTED 20; 5.4 min |
| engine door | 1 file passed, 26 passed, 1 skipped; 9 s |
| the map | `coverage_map.py`: HEADLINE 220/679, RUNTIME-ON 285/679 (+65, -0; runtime-attached 88) |
| the roadmap | `parity_roadmap.py facts` 459 scripts not served on the host lane; `build` SERVED 275/679; `check` passes; `tests/test_pine_parity_roadmap.py` 6 passed |

11-17's host refusals were also 1209 and its runtime lane reached 1836. Between the two runs, per capture:
- production: the 837 verdicts are identical;
- runtime-on: 32 moved, all on strategies.
  - 27 INCONCLUSIVE to MATCH: the W9 broker probes, engine 72's epoch bar times on a daily chart.
  - 4 MATCH to INCONCLUSIVE: `macd-shortlong-strategy-…` and `tradingview-alerts-to-mt4-mt5-forex-…`,
    RDDT and SPY. Our side now runs their broker, and those captures hold no Strategy Tester report to
    grade its trades against.
  - 1 INCONCLUSIVE to DIVERGE: `supertrend-strategy` SPY, 1 of 9 compared items.

No indicator capture moved, and no member-served script changed. The strategy broker is admitted for
no script (`strategy-decl` has no registry row).

**The static admission check, reproduced.** The same tool over the 11-17 census rows (`cov-e71`) gives
275 served: 1 allowlisted, 54 capability-admitted and 10 declined (`obj:linefill` 4, `collections:matrix`
2, one each of `request-other`, `varip`, `method-def`, `calc-bars`), which is the 11-17 map's section 1
figure for figure. It reads the registry at `99de72e7c0`. No capability has been admitted or withdrawn
between the two engines.
