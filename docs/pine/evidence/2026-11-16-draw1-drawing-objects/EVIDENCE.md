# DRAW-1: drawing objects, the coverage unit (2026-11-16)

Branch `feat/pine-coverage-drawings`, cut from `origin/master` `e9807547d0` (engine 61). This is a coverage
unit: its measure is the number of the 679 sample scripts that newly transfer through the member door, with no
capture moving MATCH to DIVERGE. No `SCRIPT_ENGINE_VERSION` bump: the history sentence is a `NUMBER PENDING`
line in `scriptEngineVersion.js`. The runtime lane stays dark for members; nothing is armed.

Census data: the engine-60 coverage census (`_resume-2026-11-01/runs/cov-e60`, both lanes) and its wall
analysis. 83 sample scripts carry a drawing-family wall on the runtime-on lane; 13 have it as their only family.

## 1. "Loss with nothing named" was the instrument's label, not an unnamed loss (commit 4c9d25c312)

The wall analysis read 29 scripts as `host objects: loss with nothing named`. Every one of them is an ATTACHED
host step whose dirty objects-only program the translation refuses `pine:objects-only` (a clean one is `ok`),
plus one `pine:constant-only`. `coverage_map.walls_of` counted that refusal as a wall of its own (bucket
`drawing-objects`, label `[drawing-objects]`) beside the ops the program already names; in 27 of the 29 every
dropped op was named, by a host guard (`dropHeads`) or by its drop key, and the member already reads the count
sentence (`objectLoss.objectLossNote`, "N of M drawing elements in this script aren't supported yet").

Now an attached step's `pine:objects-only` is walled by its named drops, and keeps the bucket only when the
program names nothing; an output-contract refusal on an attached step stays output-contract (it is about the
plots). Measured over the engine-60 caches, old tool vs new:

| | old | new |
|---|---:|---:|
| headline, production lane | 215 / 679 | 215 / 679 |
| headline, runtime-on lane | 267 / 679 | 267 / 679 |
| `attachedDirtyWalls` carrying `[drawing-objects]` | 29 | 0 |
| `[output-contract]` on an attached step | 0 | 3 (high-low-open-mid-ranges, ict-killzones-pivots-tfo, swing-highlow-zigzag-chartprime) |

Rail `tests/test_pine_coverage_draw1_relabel.py` (6 cases, 3 controls). Mutants (on this tree, restored by copy,
`git hash-object` equal): drop the attached skip -> 2 red; restore the old relabel -> 1 red.

## 2. The drops that named no guard now name one

The census counts a `guard:<kind>` drop with no head (`guardRefusals`) as "op dropped, no guard named"
(34 sample scripts at engine 60). Five return paths of the object pass's guard reader (`pine.js::guardOfIn`)
threw nothing, the C14 read-before-write withhold named its names but no guard, and a C33 `guard:partial`
named `refused`. Each now records `pine:object-condition` with its own sentence (`OBJECT_CONDITION_WHY`):
an unparsed condition, a number read off a drawing inside a loop, a state read that cannot be lifted, a
crossing inside a loop, a condition that does not reduce, and a read before the script's own later write.
Diagnostics only: what is drawn, dropped and disclosed is unchanged. The census's `dropHeads` also reads
`guardPartial` (as `partial@<line>`), so a `guard:partial` drop is matched to its guard.

## 3. Engine changes

(a) **Drawing casts build on the runtime lane** (`pineRuntimeFrontend.js`: `drawingCastFamily`, and the route
clause `holdsDrawingCast`). `line(na)`, `label(na)`, `box(na)`, `table(na)`, `polyline(na)` and `linefill(na)`
are the reference's typed `na` (the cast of `na` to a drawing id), and lower to `na` in both builds. Only the
bare `na` argument is a cast; a user function of the same name is not. Before, `box(na)` stopped the value build
`runtime:builtin` (or the route sent it to the columnar lane, which refused it the same way).

(b) **The value build names a method-form read of a drawing handle `runtime:object-op`** (`b.get_top()`
where `b` is a drawing variable, known by its cast or by the type of its first written value), which is the
refusal the member door already hands to the drawing build (`valueBuildDefersToDrawing`). Before, it read as an
unknown builtin and the drawing build was never asked.

(c) **Host lane: rows that are only `na` no longer carry `pine:constant-only`** when the script's object
program is clean (`pine.js::naOnlyObjectsWin`: every resolved row a hidden `na` constant, `0/0`; the object
program has ops; nothing dropped). Such a script draws objects and plots nothing on purpose; the plot rows say
nothing a member reads. A row with any other constant, or a dirty object program, keeps the refusal.

(d) **A fallback document no longer carries a host drawing that lost creates** (`d4133b55b3`,
`runtimeObjectsDoor.js::hostLostCreates`). When the drawing build is refused by name and the value build
stands, the door kept the host object program's partial picture. trend-levels-chartprime reached that path once
(a) built its `label(na)` casts, and both its committed captures graded runtime-on DIVERGE: the host program had
lost 12 creates (`pine:window`) and still carried their deletes, so it drew a different set of labels, not a
smaller one. Such a host picture (any `create` drop) is no longer kept: the door declines with the drawing
build's own refusal and a sentence. A host picture that lost only other steps is kept as before.

(e) **A box family whose collector ran is withheld by name on the runtime lane** (`749d8dfd0c`,
`objects:count-at-cap`; section 5).

## 4. Per target script, before -> after (the census's own predicate, both lanes)

Targets: the 83 sample scripts carrying a drawing-family wall at engine 60 (the unit's walls), plus 14 controls
that transferred. Measured on the dev PC under the lock (hold 3, tree `687e8eb8cb`, clean): the census door
(`coverageMapDoorCensus.measure.test.js`) over the target list, "before" = the touched engine files at the
merge base `c3c40aad40` (swapped in, restored from copies, `git status` clean after), "after" = this branch.
Predicate: production `clean`; runtime-on `clean`, or attached on the runtime lane (not placing orders).

| | before | after |
|---|---:|---:|
| targets transferring, production | 0 / 83 | **1 / 83** |
| targets transferring, runtime-on | 0 / 83 | **1 / 83** |
| controls transferring, production | 8 / 14 | 8 / 14 |
| controls transferring, runtime-on | 14 / 14 | 14 / 14 |
| targets with a head-less `guard:*` drop (step 0, either lane) | 10 | 0 |

Rows that moved (75 other targets keep their wall):

| script | production before | production after | runtime-on before | runtime-on after |
|---|---|---|---|---|
| committed:high-low-open-mid-ranges | attached, dirty (pine:constant-only) | **transfers (host)** | attached, dirty (pine:constant-only) | **transfers (host)** |
| committed:breaks-and-retests-hg | refused pine:reassign | same | refused runtime:expression-statement | refused runtime:function-global-state |
| committed:market-structure-trend-targets-chartprime | refused pine:statement | same | refused pine:function (`line(na)`) | refused runtime:conditional-history |
| committed:trend-levels-chartprime | refused pine:window | same | refused pine:function (`label(na)`) | refused pine:builtin (`chart.fg_color`, declined, section 3d) |
| reference:breaks-and-retests-with-volatility-stop-hg | refused pine:reassign | same | refused runtime:expression-statement | refused runtime:function-global-state |
| reference:dynamic-swing-anchored-vwap-strategy-zeiierman-x-pineindicators | refused pine:no-output | same | refused pine:function (`label(na)`) | refused runtime:expression-statement |
| reference:fvg-order-blocks-bigbeluga | refused pine:objects-only | same | refused pine:function (`box(na)`) | refused runtime:loop |
| reference:kalman-trend-levels-bigbeluga | refused pine:state | same | refused pine:function (`box(na)`) | refused runtime:conditional-history |

Where the other 75 targets stand (runtime-on, step 0): 26 attached with a dirty objects-only program
(`pine:objects-only`, each drop named), 12 attached with objects lost (partial) and 4 with lost removals, 7
`runtime:library`, 3 `pine:function`, 3 `pine:request`, 2 `pine:constant-only` with a non-`na` constant row, 2
`runtime:statement`, and 16 other single codes.

**Newly transferring: 1 script, high-low-open-mid-ranges (committed), on both lanes**, by section 3(c). Witness:
its own committed captures grade MATCH on both lanes on this tree (rddt 1d 2026-09-28 and spy 1d 2026-10-03:
504 lines, 504 / 504 labels, 1 table, 45 cells paired, 0 differing; objects v2 INCONCLUSIVE only because those
captures predate the x table).

**The coverage ratchet** (`coverage_ratchet.py`, corpus/committed, 266 scripts, both lanes measured under the
same hold): production 58 -> 59, runtime-on 86 -> 87, lost 0 on both; the snapshot
`docs/pine/coverage-ratchet.json` is written from those measured rows (`--rows ... --write`).

## 5. Admission: obj:table and obj:box admitted; obj:linefill stays out

Read off the committed runtime-on snapshot (`docs/pine/vendor-harness/runtime-on/verdicts.json`) and asked of
the door on this branch (`capability_admission.py input` over the 21 candidate captures, then
`capabilityAdmission.measure.test.js CAPADMIT_MODE=lanes`, plus the harness's own `runOurSide` objects lane):

| family | runtime-drawn, objects v2 MATCH, own records paired | decision |
|---|---|---|
| obj:table | Signal Ledger rddt + spy (1 table, 16 cells each, x MATCH 16 / 40), RCT Mann-Kendall rddt + spy (2 tables x 8 fields, 19 cells x 142 fields, 0 differing; a table carries no x) | **ADMITTED** (coordinator approval): 4 captures, 2 scripts, 2 community |
| obj:linefill | FVG Finder rddt 11-15 only. AlgoAlpha Trend Targets 11-15 grades MATCH, but its lines, labels and linefills are drawn by the HOST object program carried in the runtime document (objects lane `host`), as the registry readme already records | stays withdrawn: 1 script |
| obj:box | fair-value-gap rddt (21 boxes), sweep-reversal-map rddt + spy (11, 80), signal-follow-through-ledger rddt + spy (8, 20): every one x-graded, x MATCH | **ADMITTED** with the count-at-cap carve-out (coordinator ruling): 5 captures, 3 scripts, 3 community |

**Why Mann-Kendall moved from DIVERGE (U3b, `7a74a90f45`) to MATCH.** Not its table. At U3b its only
diverging item was a PAINT: `bgcolor` plot_4 ("Trend Background (main chart)", `force_overlay`), which our side
withholds by name and TradingView does not paint at the defaults. The grader change `968066d775` (engine 58
review, S11: "withheld-and-unpainted paints are undrawn") landed in landing train 1 (`c3ffdbb465`, engine 59)
and grades that row "neither side draws". Its objects grade was objects v2 MATCH at both commits, with the
cells compared: 2 tables (position, columns, rows, frame and border widths and colours, bgcolor: 16 fields)
and 19 cells (text, alignments, size, tooltip, font, colours: 142 graded fields, 10 not graded), 0 differing.

Rails (`tests/test_pine_capability_admission.py`): the admitted set; `DRAW1_OBJECT_FAMILIES` (`obj:table`,
`obj:box`); the withheld families are now polyline and linefill; the unadmitted member-copy examples moved from
a table and a box to a linefill, with a table now admitting as a control. A8 (no phantom evidence) holds every entry to
the snapshot, including Mann-Kendall's `objectsX: null` (no x graded). The REACH report is regenerated on
this branch into `runs/report.json` and both rails (`REPORT`, `capabilityEvidenceLane.test.js`) point to it.

**obj:box and the count at the cap.** obj:box was withheld on inside-bar-boxes-rddt-1d-2026-11-14
(runtime-drawn, objects v2 DIVERGE on the count of boxes held, vendor 52, ours 50). The id comparison settles
that it is the cap and only the cap: both sides made 158 boxes (TradingView's newest id 158, ours 158);
TradingView holds ids 107-158 (52), we hold 109-158 (50); the 50 boxes both hold pair and agree on every graded
field. The batch collector (`objectPool.js` C7: a create past cap + 5 deletes the oldest down to cap) ran on
both sides, and TradingView kept two more of the oldest. The reference, `max_boxes_count`: *"The number of last
box drawings displayed. Possible values: 1-500. The count is approximate; more drawings than the specified count
may be displayed. Optional. The default is 50."* (`max_lines_count` and `max_labels_count` read the same.)

The carve-out (coordinator ruling, scoped to what the captures show):

| family | committed captures whose collector ran | carve-out |
|---|---|---|
| box | sonarlab-order-blocks spy + brk-a (cap 20): 24 held, every one paired, as C7 predicts. inside-bar-boxes rddt (cap 50): 52 held where C7 holds 50 | **withheld by name once the collector runs** (`objects:count-at-cap`, runtime lane): the captures disagree on which rule applies |
| label | parabolic-sar rddt 11-15: 52 held, every one paired, runtime-on MATCH (and spy 50 / 50) | none: C7 is witnessed with no counterexample |
| line | trendlines spy, swing-highlow-zigzag-chartprime spy: 52 held, every one paired | none |
| polyline | no committed capture reaches the cap (100) | none needed |
| table | the store already withholds past the table count | unchanged |

The host lane is unchanged (coordinator ruling): its served scripts that reach the box cap (contraction-box,
makuchaku FVG, zero-lag-ma trend levels, atr-support-resistance, vw-object-gc-a/b) hold TradingView's counts.
The member reads `NOT_SHOWN.COUNT_AT_CAP` ("the script holds more of them than its maximum count, and
TradingView describes that count as approximate ..."). Queue rows Q-DRAW-CAP-1 (AMEX:SPY 1D) and Q-DRAW-CAP-2
(NYSE:RDDT 1D), probe `tools/visual_conformance/probes/vw-draw-count-at-cap.pine` (cap 20, a box every third
bar and an extra one every seventh, plotting boxes made against `box.all.size()`).

Over-refusal accepted for now: **sonarlab-order-blocks is withheld pending vw-draw-count-at-cap** (its runtime
boxes match TradingView's, but the collector's phase is not understood).

Rails: `engine/runtime/__tests__/draw1CountAtCap.test.js` (a box family past its trigger is withheld with
the count-at-cap reason; controls: a box family under its trigger is drawn whole, a label family past it is
drawn by C7; the reason maps to its own member sentence), `test_A7_obj_box_is_admitted_with_the_count_at_cap_
carve_out` (the registry, the capture's grade and ids, the store's line).

**The admission check per newly served script** (`capability_admission.py input` -> `capabilityAdmission.measure.
test.js CAPADMIT_MODE=admission` -> `report`, hold 3; `runs/report.json`). Admitting obj:box and obj:table admits
132 more scripts (67 captures, 33 committed, 32 reference) whose every capability is now admitted. Of the
captures, the runtime lane draws 8 under admission: signal-follow-through-ledger rddt + spy, Mann-Kendall rddt +
spy, renko-candles-overlay rddt + spy and vw-forin-collections rddt grade runtime-on MATCH; order-blocks rddt is
INCONCLUSIVE; **none DIVERGES**. The reach run's stops are unchanged (vw-deadband-ticks-brk-a, withheld whole
before this unit), `matchToDiverge` and `substitutedToDiverge` are empty. Ten newly admitted captures are
host-drawn DIVERGE (contraction-box spy x2, heat-map-seasons x2, htf-candle-footprint x2, sonarlab-order-blocks
aapl, vw-object-gc-a/b/c): those are the host lane's production pictures, DIVERGE in both committed snapshots
before this unit, and admission does not change what the host lane draws.

**Kill entries (coordinator ruling, before the engine-65 train).** With admission on in production, that reach goes to every permitted member, so every newly admitted source with a committed capture grading DIVERGE on either lane is on the committed kill list (`api/data/pine_runtime_killlist.json`) until its own `liftWhen`: contraction-box-doji-lines (lines held 204 vs 205), heat-map-seasons (table cells 30 vs 31), htf-candle-footprint-cartel-console (a box top), sonarlab-order-blocks (AAPL off-listing boxes withheld where TradingView draws 17), and the probes vw-object-gc-a/b/c (a weekly plot). 7 of the 77 newly admitted sources (22 of the 132 rows); 110 rows stay admitted. Rail: `test_DRAW1_every_newly_admitted_object_script_with_a_DIVERGE_capture_is_killed` (derived from both lanes' verdicts; control: without the DRAW-1 entries the scan names exactly those 7 sources). The REACH report was regenerated with the kills (`input` + `report`, reusing hold 3's door rows): stops unchanged, `matchToDiverge` empty, and no newly admitted capture is host-drawn DIVERGE any more.

## 6. Harness verdict moves

Local, hold 3, both lanes, over 23 selected captures (the obj:box and obj:table evidence, inside-bar-boxes,
sonarlab-order-blocks x4, parabolic-sar x3, trend-levels-chartprime x2, high-low-open-mid-ranges x2,
trend-targets-algoalpha x4), against master's committed snapshots:

| capture | lane | before | after | why |
|---|---|---|---|---|
| inside-bar-boxes-rddt-1d-2026-11-14 | runtime-on | DIVERGE (v2: vendor 52 boxes, ours 50) | INCONCLUSIVE (boxes withheld by name, `objects:count-at-cap`) | section 5 |

No other verdict moved on either lane: every obj:box / obj:table evidence capture stays MATCH (x graded, 0
differing), parabolic-sar stays MATCH runtime-on (52 / 50 labels paired), sonarlab-order-blocks is unchanged
(the host program draws it on both lanes today; the carve-out reaches it only on the runtime store, where it is
withheld pending vw-draw-count-at-cap), trend-levels-chartprime stays INCONCLUSIVE (declined by name; before
section 3d this branch drew it DIVERGE), high-low-open-mid-ranges MATCH on both. The full both-lane harness
over all committed fixtures is pine-heavy's (the PR's legs).

## 7. Still refused, by name, and the queue

- **Box count at the cap** (`objects:count-at-cap`, runtime lane): inside-bar-boxes; sonarlab-order-blocks
  withheld pending vw-draw-count-at-cap (over-refusal accepted by the coordinator). Queue Q-DRAW-CAP-1
  (AMEX:SPY 1D), Q-DRAW-CAP-2 (NYSE:RDDT 1D), probe `tools/visual_conformance/probes/vw-draw-count-at-cap.pine`
  (`docs/pine/capture-queue-2026-11-16-draw-count-at-cap.md`).
- **trend-levels-chartprime**: its drawing build stops at `chart.fg_color` (`pine:builtin`, line 165). It is
  declined by name rather than drawing the host program's partial picture; the coordinator queues a fresh
  capture of it (NYSE:RDDT 1D, AMEX:SPY 1D; existing captures 2026-11-15).
- **obj:linefill**: one runtime-drawn community script (FVG Finder); a second x-graded runtime-drawn MATCH
  capture admits it. **obj:polyline**: no runtime-drawn evidence.
- The other target walls are listed in section 4 and are not drawing walls of this unit's slice
  (`runtime:conditional-history`, `runtime:loop`, `runtime:function-global-state`, `runtime:library`, ...).

## 8. Mutants

All on tree `687e8eb8cb` (hold 3), each file copied aside, mutated, the focused rail run, restored from the copy,
`git hash-object` equal to HEAD (15 / 15 restored). Controls: the four rails green on the unmutated tree.

| id | mutation | rail | result |
|---|---|---|---|
| DRAW1-M1 | cast clause off the route decision | draw1DrawingObjects | killed (3 red) |
| DRAW1-M2 | cast arm removed | draw1DrawingObjects | killed (3) |
| DRAW1-M3 | method-form read not named `runtime:object-op` | draw1DrawingObjects | killed (2) |
| DRAW1-M4 | written drawing type not recorded | draw1DrawingObjects | killed (1) |
| DRAW1-M5 | na-only rows keep `pine:constant-only` | draw1DrawingObjects | killed (1) |
| DRAW1-M6 | na-only rows admit a constant number | draw1DrawingObjects | killed (1) |
| DRAW1-M7 | guard drop falls back to no head | draw1DrawingObjects | killed (3) |
| DRAW1-M8 | `guard:partial` keeps `refused` | draw1DrawingObjects | **survived**: no rail fixture reaches a C33 partial-guard drop; the change is diagnostics only and is unproved |
| DRAW1-M9 | keepHost decline not taken | draw1KeepHost | killed (1) |
| DRAW1-M10 | host lost creates never seen | draw1KeepHost | killed (1) |
| DRAW1-M11 | box count-at-cap not withheld | draw1CountAtCap | killed (2) |
| DRAW1-M12 | count-at-cap widened to labels and lines | draw1CountAtCap | killed (1) |
| DRAW1-M13 | count-at-cap said under the generic sentence | draw1CountAtCap | killed (1) |
| DRAW1-P1 | relabel ignores an attached output contract | test_pine_coverage_draw1_relabel | killed (1) |
| DRAW1-P2 | attached object-program refusals counted as walls | test_pine_coverage_draw1_relabel | killed (2) |

## 9. Re-derived on the engine-65 train tree (merge of origin/train/e65 `c1dd3711b6`, which contains e64)

On the merged tree `527f38c3ef`, hold 4:

- **REACH, by the tool's own three steps** (`capability_admission.py input`, `capabilityAdmission.measure.test.js CAPADMIT_MODE=admission`, `report`) into `runs/report.json`.
  - Admitted captures: 383 of 749. 52 on the runtime lane: 45 MATCH, 6 INCONCLUSIVE, 1 DIVERGE (the stop vw-deadband-ticks-brk-a, unchanged).
  - Committed scripts: 100 of 266. Reference scripts: 154 of 271. Builtins: 87 of 142.
  - `matchToDiverge` and `substitutedToDiverge` are empty.
  - It reproduces HIST's rows (#1450): kernel-channel-backquant-rddt-1d-2026-11-14 is runtime / MATCH, and momentum-based-zigzag has left the report (it is on the kill list).
  - #1486 (UDT) is not on this tree, so its BBWP -> runtime / MATCH row, spliced into the cond-ta report, is not reproduced here. It is not fought: when #1486 lands after this, its splice applies to this report, or a re-derive on a tree with both reproduces it.
- **Kill check on the merged tree:** every newly admitted obj:box / obj:table source with a DIVERGE capture on either lane is killed. That is the same seven sources, with none unkilled.
- **Coverage ratchet, both lanes, measured on the merged tree.**
  - Production: 58 -> 59 (+ high-low-open-mid-ranges), 0 lost.
  - Runtime-on: 89 -> 90, + high-low-open-mid-ranges, + volatility-trend-score-backquant, and **1 lost: mtf-key-levels-support-and-resistance**.
  - That loss is section 3(d) working as intended. The script transferred on runtime-on only by carrying the host object program's partial picture: it lost creates (`create:line` 1, `create:label` 2) while its drawing build is refused `pine:request`. Both of its committed captures grade that picture **runtime-on DIVERGE** (lines 22 paired / 51 fields differing, labels 3 paired / 24 TradingView-only).
  - It is now declined by name, and its runtime-on verdict moves DIVERGE -> INCONCLUSIVE.
  - The snapshot is written from the measured rows (`--rows ... --write`), and this loss is named here and in the PR.
