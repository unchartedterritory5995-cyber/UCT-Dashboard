# W4-T12 paint typing: evidence

Branch `feat/pine-w4-t12-paint` (desktop, builder session W4-T12).
Code tip tested: `24604edea2` (engine file `app/src/components/chart/engine/ast/pineRuntimeFrontend.js`;
the evidence commit on top is docs only). Tested-on-master (merge-base): `d8d4f0937d`.
origin/master has since moved to `e26130c7f6`; not rebased (the coordinator rebases at merge).
W3 overlap re-checked at the end (`git diff --name-only origin/master...origin/feat/pine-w3-drawings`):
pine.js, objectProgram.js, pineTextFormat.js and tests only; none of this branch's files.

## What changed (runtime front end only; no memberPaneDefinition.js or RT/colours.js edit was needed)

`holdsColour` (FE) now proves a colour through:
- `c = switch ... / if ...` whose every leaf is a colour or `na` (leaf tally on the value sink, slot marked at its binding);
- a user function whose result leaves are all colours or `na` (`record.colour`, read only from the function's OWN record);
- an element of an array built from colours (`array.from(colours)`, `array.new<color>`, `array<color>` parameter).

`fill()` accepts a plot id chosen by `?:` over a literal `true` / `false`. Every new proof is off at the
object door (`atObjectDoor`), so the C18 door builds what master builds.
The member pane needed no change: with the colour proven, the document is carried (on master it declined
`runtime:colour` / `runtime:withheld-all`).

Refused by name, capture row added (`docs/pine/capture-queue-2026-11-03-w4-t12.md`, row P2-F1): a fill plot id
chosen by an input or a series. `color.new(close, 50)` still refuses; a numeric arm still refuses.

An earlier cut read the function record by index alone; the first runtime-on census caught it
(bollinger-band-width-percentile lost its attach: a refused definition is popped but keeps its name, and the
next definition reuses the index). Fixed (`rec.name === node.name`) and railed.

## Rails (red on master, green on tip)
Files: `app/src/components/chart/engine/runtime/__tests__/w4PaintTyping.test.js` (30 tests),
`app/src/components/chart/builder/memberPane/w4PaintTypingPane.test.js` (4 tests).
Command (from app/): `node node_modules/vitest/vitest.mjs run <both files> --maxWorkers=2`, master front end swapped in
inside the hl job (`runs/w4t12b/redmaster.log`). Master: `Tests 22 failed | 12 passed (34)` (the 12 are controls that pass on both).
Tip: all 34 pass (also inside the final-tip run below).
Red on master (names): colour switch paints chosen colour; na arm hides the bar; missing default yields na; if value;
nested chain; plot(color=) over a colour switch; expression-bodied function; block-bodied function; function with na
branch; function calling a colour function; array.from of colours; colour switch under color.new; literal-true and
literal-false fill choice; the object-door gates; the stale-index control; the pane carries bgcolor, plot color= and barcolor.
One existing rail was re-pointed: `rt6ColourCarriage.test.js` FAIL-SOFT used `f() => color.red` as its
"unreadable colour"; that shape is now served, so it uses `f() => close`.

## Mutations (each applied once with `docs/pine/parity-programme/scripts/mutate.py`, restored byte-exact)
| mutation | killed by |
|---|---|
| numeric leaf counted as colour | CONTROL numeric arm keeps the refusal |
| `na` leaf not counted as na | `na` arm hides the bar |
| block accepted with a non-colour leaf | CONTROL numeric arm |
| block accepted with no colour leaf | CONTROL all-na arms say nothing |
| switch/if binding not marked colour | colour switch paints chosen colour |
| function always colour | CONTROL function returning a number |
| inline function result always colour | CONTROL function returning a number |
| block function result not stamped | function ending in an `if` chain with na |
| function proof not gated off at the door | the object-door gate |
| array proof `every` -> `some` | CONTROL mixed array |
| array element read off | array.from of colours |
| nested arm resets the tally | colour switch paints chosen colour |
| arm tally detached from the sink | colour switch paints chosen colour |
| fill folds any ternary (not only literals) | CONTROL series condition keeps fill-target refusal |
| fill fold not gated off at the door | fill choice off at the object door (added after the first run left it SURVIVED) |
| `color.new` accepts a number | CONTROL color.new(close, 50) |
| function record read by index only | CONTROL refused selector beside a colour helper |

Equivalent (named, not mutated): the `other += 1` on the multi-slot leaf and on a valueless end. Neither changes a
single-slot verdict (`resultColour` is also guarded by `n === 1`, and a valueless record is excluded in `holdsColour`).
Log: `runs/w4t12/mutations.log` (first 16 on tip 171202fbec, same code but the name check); the two re-proofs ran in the worktree.

## measure-pair (base `pine-dsk-mpbase` switched to master `d8d4f0937d` inside the hl job)
Command: `measure-pair.sh <out> tip:<wt> base:<base> <0|1> 1`. Logs: `runs/w4t12b/mp0.log`, `mp1.log`.

Runtime lane 0: `== side tip 24604edea2`, `== side base d8d4f0937d`.
- C18 corpus audit (395 keys) diff 0; C18 probes (69) diff 0.
- Harness `336 captures MATCH 93 DIVERGE 103 INCONCLUSIVE 140` on both sides, byte-identical.
- Census (967 rows, lane production): 1 row differs, `reference:luxy-momentum-...-__0fa143447a`, only in `dropReasons`
  counts at one peel step. NOISE on the BASE side: base differs between two runs of the same master
  (`runs/w4t12/mp0` vs `runs/w4t12b/mp0`); the tip row is identical across both runs.

Runtime lane 1: `== side tip 24604edea2`, `== side base d8d4f0937d`.
- C18 audit diff 0; C18 probes diff 0.
- Harness `336 captures MATCH 111 DIVERGE 107 INCONCLUSIVE 118` on both sides, byte-identical.
- Census (967 rows, runtime-on): 2 rows differ.
  - `reference:supertrend-mtf-heatmap__ODcEBlvB3g`: INTENDED. Base declines `runtime:colour` at peel steps 6-7; tip attaches
    on the runtime lane at step 5 (reachedAfterPeel False -> True, peelSteps 7 -> 5).
  - `committed:multi-timeframe-trend-indicator__fa4022ecf5`: NOISE. `pine:timeout` (10 s translate budget, host lane) on both
    sides at the same step; only the line it names differs (160 vs 135). The same script also flipped in the first lane-0 run.
- 0 unintended diffs.
- The first cut regressed `committed:bollinger-band-width-percentile__03JuGF728K` on lane 1 (first measure-pair,
  `runs/w4t12/mp1`); fixed, and the re-measure above shows no diff on that row.

Spec walls: none of `nonlinear-regression-zero-lag-moving-average-loxx`, `visualizing-displacement-tfo`,
`color-gradient-framework-pinecoders`, `edufx-amd`, `mema-bb-parabolic-sar`, `vwap-supply-demand-zones-pro` moved. Their
first walls are other shapes: `color.new(_c_bull, ...)` over a `color`-TYPED PARAMETER, `fill(p1, p2)` with no colour,
`box.new` (object program), `runtime:output-map`, `runtime:withheld-all`. Open items.

## final-tip on the final tree (`final-tip.sh pine-dsk-w4t12 w4t12-final2 tests/test_script_engine_version_gate.py`)
Tip `24604edea2`. Gate pytest `46 passed` (no_shadowed_definitions, dockerfile_vite_build_args, vite_flag_ledger,
visibility_flag_ledger); `tests/test_script_engine_version_gate.py` `6 passed`; hygiene clean (34667 tracked files).
Full chart+hooks vitest: `Test Files 1 failed | 1335 passed | 27 skipped (1363)`,
`Tests 1 failed | 22394 passed | 118 skipped (22513)`.
The one failing file is `src/hooks/pollingSites.rail.test.js`, the desktop baseline (pre-existing).
Logs: `runs/w4t12-final2/{gate,hyg,py,js}.log`.

## Engine bump
Yes: door outcomes change on the runtime lane (refusals become served values). The coordinator bumps
`SCRIPT_ENGINE_VERSION` at merge; not edited here. No licence-held text is included.

## Round r1 (review NO-GO @f8ddebfa76: B1 MEDIUM, note N1)
Code tip `4e813ca81c` (tests plus one helper; no engine behaviour change).
- B1: the two object-door gates that had no rail now each have one, in `runtime/__tests__/w4PaintTyping.test.js`
  ("the object door builds what master builds"): a colour `switch`, a colour `if` block, and an element of a colour array. Each builds
  on the pane (`ok`) and is refused at the door with master's guard (`runtime:colour`; the `if` block asserts only `ok:false`).
  Mutations (`mutate.py`, restored byte-exact, `runs/w4t12r1/mut.log`), all KILLED: R1 drop `!atObjectDoor &&` at the switch/if
  binding (`:9678`; killed by the switch and the if rails), R2 drop it at the colour-array read (`:2675`; killed by the array rail),
  R3 the shared `literalBool` reads nothing (killed by the literal-true / literal-false fill rails).
  The EVIDENCE statement "every new proof is off at the object door" is now proved for all four gates.
- N1: `literalBool` is one exported module-level helper; the fill reads it (W4-T13 uses the same one).
- No re-measure: only tests and a helper hoist changed.
- final-tip last, on the final tree (`final-tip.sh pine-dsk-w4t12 dsk-w4t12r1-final tests/test_script_engine_version_gate.py`, `runs/w4t12r1/final.out`):
  gate pytest `46 passed`; `test_script_engine_version_gate.py` `6 passed`; hygiene clean;
  vitest `Test Files 1 failed | 1335 passed | 27 skipped (1363)`, the one failure the `pollingSites.rail` baseline.
