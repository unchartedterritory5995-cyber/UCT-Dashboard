# Engine 51: `table.cell` positional order, named addresses, every enum constant, computed enums

Branch `fix/pine-engine51-cell-order`, rebased on master `fecbf19fb6` (engine 50, PR #1141, merged). Slice S1 of the
drawing-objects lane (scope report `runs/objects-lane/SCOPE-2026-11-12.md`, outside the repo).

## The defect
The Pine v4-v6 reference signature is

```
table.cell(table_id, column, row, text, width, height, text_color, text_halign, text_valign,
           text_size, bgcolor, tooltip, text_font_family, text_formatting)
```

(`docs/pine/pine-presentation-spec.md` 4.7.3). The host lane's `pineObjects.js::CELL_POSITIONAL`
listed slots 7-9 after the address as `bgcolor, tooltip, text_size`. The runtime lane's
`objectStore.js` `table.cell` signature, and `CELL_POSITIONAL`'s own comment, had Pine's order.

What the old order did to a positional cell (measured on the unfixed reader, the same 1-line
tables as the rail):

| positional args after the address | what the host lane produced |
|---|---|
| 7 (`…, text_valign, size.small`) | `text_size` dropped (read as a colour, unreadable, counted in `droppedProps`); cell drawn at the default size |
| 8 (`…, size.large, color.yellow`) | `text_size` AND `bgcolor` dropped (2 `droppedProps`); cell drawn at the default size with no background |
| 11 (all slots) | `text_size` = the TOOLTIP's text node (a wrong-typed value in a size slot), `bgcolor` and `tooltip` dropped |

The same calls written with names were read correctly. No refusal named any of this: the cell
was drawn, wrong.

## What changed
- `ast/pineObjects.js`: `CELL_POSITIONAL` in Pine's order (`text_size, bgcolor, tooltip`).
- `runtime/objectStore.js`: comment only (it said the host table was not its lane's to change).
- `tools/pine_text_helper_census.py`: carried a copy of the old order (`table.cell` and the
  method form `cell`); fixed. A census tool, no engine output.
- `scriptEngineVersion.js`: 50 -> 51, history line.
- New `ast/cellPositionalOrder.test.js` (6 tests):
  - rail 1, cross-lane: `CELL_POSITIONAL` is DERIVED from `OBJECT_OPS['table.cell'].params`
    after the three-argument address, slot for slot; and every host `CELL_SETTER_PROPS` entry
    writes the property the runtime lane's `table.cell_set_*` op writes.
  - rail 2, one cell two spellings: an 11-argument and an 8-argument positional cell, and the
    method spelling with 10 arguments after its two-argument address, translate to the same
    cell props as the named call, with `text_size`, `bgcolor`, `tooltip` and
    `text_formatting` values pinned.

## Census
Text scan of every positional `table.cell` / `<id>.cell` call (comments stripped, strings and
nesting respected, calls spanning lines followed), over the engine-50 census sources: repo
`corpus/` (266 files), repo fixtures (`tests/fixtures`, `tools`, `docs/pine`,
`runtime/__fixtures__`: 573), vendor capture sources (`tests/fixtures/vendor/**.json`
`source.text`: 353) and the licence-held sample (`_resume-2026-11-01/pine-sample`: 413).

- 2,637 cell calls, every `.cell(` occurrence in those 1,605 files matched (the scanner's own
  control: 2,637 of 2,637).
- Positional arguments after the address, the maximum anywhere: **5** (7 calls in the corpus, 12
  in captures, 3 in the sample). The defect needs **7**.
- **0 scripts change output.** No vendor capture covers such a call, so there is no capture to
  move toward or away from TradingView. The scope report's owner probe **Q-S1-cell** (a capture
  of a 10-argument positional cell) remains the way to witness the fixed order on TradingView.
- JS/py sources (tests, tools, services, api) carry no such call either (one hit: the comment in
  `pineObjects.js` that quotes the signature).

## Other positional tables, checked against the reference
| table | reference | state |
|---|---|---|
| `CREATE_POSITIONAL.line` | `line.new(x1, y1, x2, y2, xloc, extend, color, style, width, force_overlay)` | matches |
| `CREATE_POSITIONAL.label` | `label.new(x, y, text, xloc, yloc, color, style, textcolor, size, textalign, tooltip, text_font_family, force_overlay, text_formatting)` | matches |
| `CREATE_POSITIONAL.box` | `box.new(left, top, right, bottom, border_color, border_width, border_style, extend, xloc, bgcolor, text, text_size, text_color, text_halign, text_valign, text_wrap, text_font_family, force_overlay, text_formatting)` | matches |
| `CREATE_POSITIONAL.table` | `table.new(position, columns, rows, bgcolor, frame_color, frame_width, border_color, border_width, force_overlay)` | **MISSING the 9th slot `force_overlay`** (objectStore `TABLE_NEW` has it). A 9th positional argument is silently dropped by `namedOrPositional` while the named spelling reaches `unsupportedProps`. Census: 0 calls with 9 positional arguments (max 8, 16 calls). NOT changed here (report only; follow-up). |
| `CREATE_POSITIONAL.linefill` | `linefill.new(line1, line2, color)` | matches |
| `CLEAR_POSITIONAL` (`table.clear`, `table.merge_cells`) | `(table_id, start_column, start_row, end_column, end_row)` | matches |
| `POINT_OVERLOADS` | v6 `chart.point` overloads | match |
| `SETTER_PROPS` set_xy1/set_xloc/set_lefttop … | argument order after the handle | match |
| `CELL_SETTER_PROPS` | one property each | match; `cell_set_text_font_family` absent on the host (runtime has it) |
| `SETTER_PROPS.label` / `.box` | | `label.set_text_font_family`, `box.set_text_wrap`, `box.set_text_font_family` absent on the host (runtime has them): absent names, not misordered ones |

## Mutants
Harness: copy the file, edit, run `cellPositionalOrder.test.js`, restore FROM THE COPY, then
`git hash-object` == `HEAD:` blob (all true).

| id | mutant | result |
|---|---|---|
| C0 | none (control) | 6/6 green |
| M1 | host back to the old order (`bgcolor, tooltip, text_size`) | RED 4: rail 1 slot-for-slot + all three rail-2 spellings |
| M2 | runtime `CELL_ARGS` drifts alone (`bgcolor, text_size`) | RED 1: rail 1 slot-for-slot |
| M3 | host `cell_set_bgcolor` writes `text_color` | RED 1: rail 1 setter rail |
| M4 | host swaps only `bgcolor`/`tooltip` | RED 4 |

## Also found while building PR B (NOT changed here; engine follow-ups)
The objects-v2 re-grade (`docs/pine/evidence/2026-11-12-objects-v2/EVIDENCE.md`) found two host
lane defects in the same family, each witnessed by a vendor capture:
- **A NAMED cell address is read positionally.** `table.cell(t, row=1, column=0, …)` (and
  `table_id=t, row=…, column=…`, and `table.cell_set_*` with named `row`/`column`) puts the cell
  at column 1, row 0. `table.clear(t, start_row=…, start_column=…)` reads names correctly.
  Witness: `keltner-center-of-gravity-channel-{rddt,spy}` draws its `"|"` cell at (0,1) on
  TradingView and (1,0) on ours. v1 graded both MATCH.
- **v4 label style aliases** `label.style_labeldown` / `label.style_labelup` reach the program
  as `labeldown` / `labelup`, which the renderer does not know, so the label is drawn centred with
  no pointer; TradingView records `label_down` / `label_up`. Witness:
  `extrapolated-pivot-connector-{rddt,spy}`.

## Runs
- Focused, after the rebase onto engine 50 (`7565e3e510`): `cellPositionalOrder.test.js`,
  `objectPhase2Vocabulary.test.js`, `tableTextFormatting.test.js`: 3 files, 92 tests green.
- Mutants above re-run on the rebased head: all as listed.
- `hostParity --write`: 166 cases written; ONLY `digest` (166) and `script_engine` (50 -> 51)
  moved. `--host node --check`: HP-1 GREEN 166/166. `--mutation-control`: HP-4 GREEN (the
  perturbed bundle is red on 35 cases).
- `service_smoke.json` re-recorded against a local engine-51 pine-runtime service (Node 20.18,
  the Dockerfile's permission flags, a throwaway in-memory secret): `--record` PASS, then a plain
  smoke PASS (engine 51/1/1, canary green, digest `cf5a5f024e30`, unsigned POST 401). Only
  `digest` and `identity.script_engine` moved.
- Python: `test_pine_runtime_engine_identity`, `test_pine_runtime_codec`,
  `test_pine_runtime_client`, `test_saved_script_prebump`: 408 passed.
- Whole folders in ONE heavy-lock run (`ast`, `runtime/__tests__`, `__tests__`, `--maxWorkers=1`):
  933 files, **16,386 passed, 2 failed, 184 skipped** (907 files passed, 24 skipped). The 2
  failures are `rsRatingDef.test.js` and `rsVsEmaDef.test.js` ("registered last / beside
  rsLine"): PR #1136 (`fecbf19fb6`, `feat/rs-exit`) added `rsExit` to the server-lane registry
  without updating them. They fail identically on master without this branch; not touched here.
  No h1Ratchet timeout.

## Part 2 (coordinator, 2026-11-12): three witnessed object defects folded in, still engine 51

The objects-v2 grader (PR #1150) found three drawings TradingView draws differently, each on a
vendor capture v1 graded MATCH. All three are fixed here; the engine number stays 51.

### 1. A named address was read by position (keltner-center-of-gravity-channel)
`emitMethod` took the handle as the first argument and `table.cell`'s address as the next two,
whatever their names. `table.cell(width, row=1, column=0, ...)` drew at column 1, row 0;
TradingView draws column 0, row 1. `table.clear(table_id=t, ...)` addressed nothing.

- `pineObjects.js::placeObjectArgs` places every argument by Pine's rule, once. The handle is
  `table_id` for tables and `id` for the rest. The ops covered are `table.cell` (column, row,
  then `CELL_POSITIONAL`), every `table.cell_set_*` (column, row, then the one property),
  `table.clear` / `table.merge_cells` (`CLEAR_POSITIONAL`), every setter (`SETTER_PROPS`) and
  `delete`.
- A one-property setter takes its value under any name except the handle's. That is the runtime
  lane's own rule; Pine names that value `x`, `color`, `width` and so on.
- A multi-property setter takes the property names or Pine's (`SETTER_PINE_NAMES`, for example
  `set_xy1(id, x, y)`).
- A call Pine would not place is refused by name and never read by position. That covers an
  unknown name, a value given twice, a positional after a named argument, and too many arguments.
- Host getters accept a named `id` (`line.get_y2(id=l)`).
- The runtime lane already placed arguments by name (`pineRuntimeFrontend.js` `objectCall`
  lowering) and is unchanged.

### 2. Label styles passed by pattern (extrapolated-pivot-connector)
`objectEnumValue` let any `label.style_*` (and `box.style_*`) through and kept the text after the
underscore. The v4 `label.style_labeldown` therefore reached the renderer as `labeldown`, a word
it does not know, and drew centred with no pointer. TradingView records `label_down`.

- `objectEnums.js` (new) is ONE table, by namespace, of every constant a drawing's enum slot can
  hold. It holds every member the reference lists for `xloc`, `yloc`, `extend`, `line`, `label`
  (21), `size`, `text`, `position` and `font`, plus the legacy spellings a capture witnesses:
  `label.style_labelup` maps to `label_up` and `label.style_labeldown` to `label_down`.
- `pine.js::objectEnumValue` reads only this table, for both lanes (the runtime frontend asks the
  same function). A name the table does not hold is not a word.
- Rails:
  - `docs/pine/pine-v6-constants.md` is PARSED, and every constant it lists for those namespaces
    must map. Each namespace must hold exactly the reference's count.
  - The renderer's `objectCanvas.js::LABEL_ANCHOR` must equal the label words.

### 3. A computed cell size became the default (ict-killzones-pivots-tfo)
`text_size = get_size(input.string('Small', ...))`, where `get_size(x) => result = switch x ...`,
was an `enumUnreadable` slot, dropped. The cell was drawn at the default size; TradingView draws
`small`. The same was true of the table's `position` (`get_table_pos`).

- C47 makes such a helper opaque to every lane except the drawing one, which reads it through
  `objectLane`. The text reader (`textNodeOf`) now takes that same door, so the switch's word is
  carried (`small`, `top_right`).
- **An enum slot this door cannot read now WITHHOLDS its drawing by name.** That means a constant
  the table does not hold, or a computed word the reader cannot follow. The guard is
  `pine:enum-unreadable` and the drop is `enum:unreadable`, never the renderer's default. The
  three ways an enum slot withholds (`na`, named-call, unreadable) are one table,
  `enumNaRule.js::ENUM_DROPS`, read by the create, setter and cell converters. `objectLoss.js`,
  `editorStatus.js` and `EDITOR-STATUS-PANEL-SPEC.md` section 4 carry the new reason.
- `tableTextFormatting.test.js`'s "an unreadable text_formatting keeps the cell" now expects the
  cell withheld (`text_formatting = close`, which Pine would not compile anyway).

### What "withhold, never default" costs, measured in the rails it moved
These rails pinned the old behaviour of drawing a default, or failing in a different way; each was
updated with the reason written in.

- **uncharted-volume-v2** (`memberPaneTables`, `pineTableVendorParity`, vendor `fillText`
  captures, SPY and AGEN). The Volume table's position is `f_getTablePos(hasRecentHV ?
  'Top Center' : volTablePosition)`, a per-bar choice this door cannot fold.
  - It was drawn at the default `top_right`. That is right only while no HV event is recent,
    which is what both captures show; the old test called it "a coincidence is not a result".
  - **It is now withheld by name (`table@490`)**, so **this vendor capture moves from 4 drawn
    cells (3 range + the Vol cell, text matching) to 3** (the range table, unchanged and
    byte-identical).
  - Three Vol-cell value cases are kept as `it.skip` with their pinned numbers, ready for the day
    the per-bar position is served (`textEqTree` under enum reads, gated off since C22).
  - **This is the one place the new rule moves a capture-backed drawing away. The coordinator
    rule "never render at the default" was applied as written.**
- **atr-bands** (`c45NamedInputDefaults`): the position comes from a helper that reassigns in its
  switch arms, so the table is withheld. It used to be drawn `top_right` while the input says
  Bottom Right. Its vendor capture holds no object.
- **auto-trendline** (`capRound4`, `f4SpyDrawings`): still withheld whole. The guard is now
  `pine:object-ops-refused`, because its `extend` is unreadable, instead of
  `pine:object-removal-lost`.
- `objectRuntimeValues`: the runtime-fed label is still dropped whole, now as `enum:unreadable`.
- `objectLoss`: the emitted drop keys now include the `ENUM_DROPS` table.
- `pineProbeReplay`: htf-liquidity's Resolver pin moved, because its label sizes are now read.
- `tableTextFormatting`: an unreadable `text_formatting` now withholds the cell.

### Same pattern, reported, not changed
Props other than enums that cannot be read are still dropped and drawn at the default. This is the
census tip, 1,605 files: 453 sites in 38 files.

| prop | sites | files |
|---|---|---|
| `cell.bgcolor` | 213 | 20 |
| `cell.text_color` | 156 | 17 |
| `cell.tooltip` | 20 | 4 |
| `label.textcolor` | 14 | 6 |
| `table.border_color` | 10 | 7 |
| `label.color` | 9 | 5 |
| `table.frame_color` | 9 | 6 |
| `line.color` | 6 | 3 |
| `table.bgcolor` | 5 | 5 |
| `table.rows` | 4 | 4 |
| `table.columns` | 2 | 2 |
| `label.tooltip`, `cell.width`, `linefill.color` | 2, 2, 1 | |

Colours fall under the C44 colour rules. These are the next candidates for "withhold, never
default".

### Census, part 2 (base `caa39eee69`, cell order only, vs tip `49d4a35a32`; sources read from one tree)
The census translates every file with the host translator. It hashes the object program, the
outputs and the runtime verdict.

- 128 of 1,605 files hashed differently. **92 of them differ in JSON key order only**: the
  census hashes `JSON.stringify` of the program, and `emitMethodOn` rebuilds a cell's arguments in
  `CELL_POSITIONAL` order, so a cell written with named arguments carries the same properties in
  a different key order. (Corrected in review: this said "state carried between translations in
  one process", which was wrong. Part 3's census hashes the canonical, key-sorted program as
  well, and separates the two.)
- The remaining **33 distinct scripts (36 rows) change**:

| change | scripts |
|---|---|
| label `labeldown` -> `label_down` | extrapolated-pivot-connector (corpus + 2 captures); fikira-pivots-fibonacci-retracement-3, relative-strength-index-divergences-libertus (sample) |
| named cell address now placed (col 1 -> 0) | keltner-center-of-gravity-channel (corpus + 2 captures) |
| named cell address now placed (col was read as `'center'`) | smoothed-gaussian-trend-filter-algoalpha |
| computed enum now carried | ict-killzones-pivots-tfo (table position + 12 cell sizes; corpus + 2 captures); htf-liquidity-dashboard-tfo (label sizes; corpus + 2 captures) |
| drawing withheld by name (`enum:unreadable`) instead of drawn at a default | advanced-custom-multi-ma (11 -> 0 ops), atr-bands (29 -> 0; corpus + 2 captures, whose capture holds no object), auto-trendline-dojiemoji (8 -> 0; corpus + 2 captures, already withheld whole by the object gate), candlestick-patterns-on-backtest (2 -> 0), delta-imbalance-map (20 -> 0), stop-loss-clustering (19 -> 17), volume-footprint (27 -> 16), volume-spikes (2 -> 0), sector-rotation fixture (10 -> 3), ultimate-opening-range-breakout luxalgo (2 fixtures, 9 -> 0), seasonality, dynamic-support-and-resistance (94 -> 81), ichimoku-kinko-hyo (76 -> 0), rsi-multi-timeframe-dashboard (8 -> 0), cobra039s-crypto-market-visualizer and crypto-correlation-matrix (objects-only -> `pine:no-output`) |

### Objects v2, before and after (PR #1150's grader on this branch's code, 152 captures)
|  | MATCH | DIVERGE | INCONCLUSIVE |
|---|---|---|---|
| before (cell order only) | 69 | 41 | 15 |
| after | 75 | 35 | 15 |

| family | v2 before M/D | v2 after M/D |
|---|---|---|
| lines | 87/2 | 88/1 |
| labels | 85/4 | 87/2 |
| tableCells | 78/17 | 82/13 |
| boxes, tables, linefills | unchanged | unchanged |

- **All six named captures move DIVERGE -> MATCH:** extrapolated-pivot-connector rddt+spy,
  ict-killzones-pivots-tfo rddt+spy, and keltner-center-of-gravity-channel rddt+spy.
- htf-liquidity-dashboard-tfo-rddt: its lines family moves DIVERGE -> MATCH.
- **0 captures and 0 families move away from TradingView.** v1 is unchanged: 79 / 31 / 15.

### Mutants, part 2 (`engine51ObjectFixes.test.js`, 13 rails; restore from the copy, hash == HEAD blob, all true)
| id | mutant | result |
|---|---|---|
| C0 | none | 13/13 green |
| N1 | argument names ignored (all positional) | RED 7 |
| N2 | handle taken as the first argument again | RED 2 |
| N3 | legacy `labeldown` alias removed | RED 1 |
| N4 | the `label.style_*` pattern pass-through restored | RED 1 |
| N5 | an unreadable enum dropped to the default again | RED 3 |
| N6 | text reader without the `objectLane` door | RED 1 |
| N7 | a reference constant (`style_text_outline`) missing from the table | RED 2 (reference rail + renderer rail) |
| N8 | a getter's named `id` not read | RED 1 |
Cell-order mutants M1-M4, re-run on the new head: as before (RED 4 / 1 / 1 / 4).

### linefill counts (read-only, NOT the same root cause, not changed)
liquidity-pools-spy: TradingView holds 504 fills, ours 252. price-action-as-in-book-spy: 261
against 49. In both captures TradingView keeps fills whose lines it no longer holds:

| capture | fills whose lines are not held | of |
|---|---|---|
| liquidity-pools-spy | 252 | 504 |
| price-action-as-in-book-spy | 212 | 261 |

- Their lines were collected by the 500-object limit (both captures hold about 500 lines).
- Our runtime reaps a fill with its line (`objectRuntime.js`: "Pine destroys a linefill when
  either of its lines is deleted").
- Ours equals TradingView's fills whose BOTH lines are held, exactly: 504 - 252 = 252, and
  261 - 212 = 49. The rddt captures (no collection) match.
- Whether TradingView DRAWS a fill whose lines were collected is not captured. A fill with no
  lines likely has no geometry, so this may not be visible at all.
- Follow-ups:
  - the objects-v2 grader could pair only drawable fills, the C44 `undrawn` ruling;
  - a probe capture could settle it.

### Runs, part 2 (head after merging master `150283034b`)
- Focused: `engine51ObjectFixes` (13), `cellPositionalOrder` (6), and PR #1150's
  `vendorHarness.objectsV2` (merged), all green.
- Mutants N1-N8 and M1-M4 re-run on the final head: as tabled above.
- hostParity: `--check` HP-1 GREEN 166/166, before and after the merge. `--write` moved no digest
  (the fixes change no runtime column); HP-4 GREEN (35 red).
- `service_smoke.json` re-recorded against a local engine-51 service: identical (digest
  `cf5a5f024e30`), so not re-committed. Plain smoke PASS.
- Python engine-identity, codec, client and prebump: 408 passed.
- Whole folders (`ast`, `runtime/__tests__`, `__tests__`, plus `editorStatus.families`) in ONE
  heavy-lock run on `4af0da58e5`: 935 files, **16,413 passed, 2 failed, 187 skipped**. The 2 are
  the master reds `rsRatingDef` / `rsVsEmaDef` (#1136). They are still red on master
  `150283034b` and are not touched here.
- Objects v2 on the merged head, with #1150's merged grader: v2 **75 MATCH / 35 DIVERGE /
  15 INCONCLUSIVE** (v1 79 / 31 / 15). Four v1-MATCH captures still diverge under v2:
  - the two linefill counts (cause established above, not this PR's);
  - vw-call-site-history rddt+spy (creation order only).

## Part 3 (review of #1149, CHANGES-REQUIRED): the fixes, still engine 51

### B1: a value fixed before bar 0 is read, so the three false refusals are drawn
The drawing lane's static enum reader (`staticEnumValue` in `buildObjectProgram`) reads a
position, size, style or extend whose every input is fixed before bar 0 (C16: an input no knob
reads holds its default), through:

- (a) `var x = <expr over inputs and literals>`, at the top level or declared once inside a block,
  and never reassigned (a reassigned `var` is not read as its initializer; rail);
- (b) a `switch` whose arm keys are named string consts, or the script's own `enum` members
  (`input.enum(PanelPosition.bottom_right)` handed to `parse_position(PanelPosition p)`);
- (c) `pos = switch s …` followed by a final `pos` (the review's failing input, now `top_right`);
- (d) a default assigned, reassigned in the arms (`pos := …`), then `pos`;
- also: a `var` switch with no subject (`var string tablePosition = switch` / `cond => …`), and a
  block-local `x = switch s` (seasonality, inside `if barstate.islast`).

A choice that depends on a bar value is not folded: it is carried as that choice (an `if` node,
evaluated where the op runs; rail). **A name the member can move is never folded**: a declared
input (`declareInputs`, the member door's knobs; an `input.string` with options is an enum knob
there) or one handed a value (`inputValues`) is left to the per-bar reader, which reads the knob
(rail, mutation-proved). An input only a drawing reads gets no knob in the door, so its default is
its value, which is what the folded word is.

| script | master (`eec65fb779`) | `3793f7b336` (last push) | now |
|---|---|---|---|
| delta-imbalance-map | 20 ops; position and 11 cell sizes dropped (drawn at the defaults) | 0 (withheld) | 20, `top_right`, sizes `normal` |
| crypto-correlation-matrix | 4; position dropped | 0, `pine:no-output` | 4, `top_right` |
| rsi-multi-timeframe-dashboard | 8; position dropped | 0 | 8, `top_right` |
| atr-bands (corpus + 2 captures) | 29, drawn `top_right` while the input says Bottom Right | 0 | 29, `bottom_right` |
| ultimate-opening-range-breakout luxalgo (2 fixtures) | 9; position and 6 sizes dropped | 0 | 9, `top_right`, sizes `small` |
| advanced-custom-multi-ma | 11; position and 9 sizes dropped | 0 | 11, `bottom_right`, sizes `small` |
| volume-footprint | 27; both tables at the default position | 16 | 20; tables at the input position (`bottom_right`); 7 cells withheld for integer point sizes (m4) |
| auto-trendline-dojiemoji (corpus + 2 captures) | 8; extend dropped | 0; extend unreadable (withheld whole) | 8, extend `right` |
| ichimoku-kinko-hyo | 76; position and 23 sizes dropped (`input.enum`) | 0 | 76, `bottom_right`, sizes `small` |
| cobra039s-crypto-market-visualizer | 3; position dropped | 0, `pine:no-output` | 3, `bottom_right` |
| volume-spikes | 2; position dropped | 0 | 2, `bottom_center` |
| seasonality | 2; position dropped | 0 | 2, `bottom_center` |

Rendered through the member door on 300 synthetic bars (`objectReaderFor` + `evaluateObjects`),
master vs tip, for every non-capture script whose program changed: 17 scripts reach a drawing. 12
draw identically. 5 differ, and each moves toward TradingView: three `labeldown` -> `label_down`,
keltner's named address, and volume-spikes, whose eight per-bar tables at no position become one
table at `bottom_center` (Pine's tables replace each other by position).

### B2: uncharted-volume-v2's Volume table stays withheld, and why
- It is made on the LAST bar: `if barstate.islast and not skipAll` / `if show_volume_table` /
  `var table volTable = table.new(volPos, …)`, and `table.set_position(volTable, volPos)` runs on
  every pass. So the position is not evaluated on bar 0.
- `volPos = f_getTablePos(hasRecentHV ? 'Top Center' : volTablePosition)`. Both arms are fixed, and
  the reader now lifts the choice out of the helper (`hoistEnumChoice`): `top_center` / `top_right`.
- The condition is the `hasRecentHV` column: `not na(lastHVBarIdx) and (bar_index - lastHVBarIdx)
  <= volTableLookback`, with `lastHVBarIdx` latched on `isHVEvent`.
- `isHVEvent` reads `ta.highest(volD[1], …)` inside `if not skipAll and isDaily`, and `skipAll`
  holds `not hasVolumeData`, `hasVolumeData = ta.cum(nz(v)) > 0`. The block does not run on every
  bar, so Pine's `ta.highest` there sees only the bars it ran on. The value lane refuses that
  history by name (C31, `pine:block`: "`priorMaxAllTimeDaily` calls `ta.highest` inside a block
  that does not run on every bar"), so the column the choice needs is not served on the last bar.
- Neither serving condition holds, so the table is withheld by name and never drawn at
  `top_right`. `memberPaneDefinition.test.js` now expects "10 of 18", with that reason written in.

### M3: setters and cell patches withhold, never keep the old value
`label.set_size(lb, array.get(…))` withholds the label; `table.cell_set_text_size(t, c, r,
array.get(…))` withholds the table (`contentLost`, by handle). `label.set_size(lb, size.large)` is
served (control). The same rule withholds the line `line.set_style(l, na)` restyles (the
`vw-hs1-enum-na` probe, row S01), which master left dashed; the probe's L04 (a matched helper arm)
is now served `dashed`.

### m4: integer point sizes
Not served: the canvas and the table renderer size text by the six `size.*` words only. Withheld by
name (`ENUM_DROPS.points`, `pine:text-size-points`): "the text size of this drawing is an integer
point size (Pine v6 `text_size` in typographic points), which this chart does not draw yet".
Detected for a number literal, `input.int` / `input.float` / `input` with a numeric default, or a
name bound to one. dynamic-S&R 94 -> 81, sector-rotation fixture 10 -> 3, volume-footprint 7 cells,
stop-loss-clustering 19 -> 17.

### m5: the headline names the withheld drawing
A script with no plot and no alert condition whose drawing was withheld now says, for example:
"this script has no plot or alert condition, and the label it draws at line 4 is withheld: the text
size of this drawing is an integer point size …" (guard `pine:text-size-points`). The corpus metric
moves one row: linear-regression-channel-breakout-strategy, host guard `pine:no-output` ->
`pine:enum-unreadable` (its side label's style is a ternary over `slope[1]`; nothing drawn before
or after).

### R6 and L7: the reader's refusals, pinned; setter names from one table
- M4: `table.cell(t, text="x", 0, 1)` (positional after named, no duplicate to mask it): refused.
- M11: `line.set_x1(l, a, b)`: refused, "more arguments than it takes".
- M9 / L7: the any-name rule is gone from BOTH lanes. A setter's value is placed by Pine's
  parameter name only, from `SETTER_PINE_PARAMS` (`engine/objectSetterParams.js`), read by the host
  reader (`placeObjectArgs`) and the runtime lane (`lowerObjectCall`). `box.set_bgcolor(id=b,
  color=c)`, `box.set_border_width(b, width=3)` and `line.set_x1(l, x=…)` are served;
  `label.set_text(lb, txt="a")`, `line.set_color(l, colour=c)` and `box.set_bgcolor(b, bgcolor=c)`
  are refused in both lanes. Rails derive the table's coverage from `SETTER_PROPS` and the runtime
  `OBJECT_OPS`, and check every setter signature `pine-presentation-spec.md` writes out.

### L8, L9
- `scriptEngineVersion.js`: the 51 history line now describes named placement, `objectEnums`, the
  withhold rule (enums and point sizes) and the door readings.
- The part-2 census note is corrected above: key order, not carried state.

### Census, part 3 (base master `eec65fb779`, tip this branch; sources read from one tree)
The census now also hashes the canonical (key-sorted) program.

- 169 of 1,605 rows hash differently. **53 differ in JSON key order only** (13 captures, 13
  corpus, 14 fixtures, 13 sample).
- 116 rows change the program (84 distinct non-capture scripts, classified per prop):
  - **a value master dropped (drawn at the default) is now read**: 17 scripts (the B1 table, plus
    ict-killzones, htf-liquidity-dashboard and smoothed-gaussian-trend-filter);
  - **a per-bar choice over input comparisons is now folded to its one value**: 60 scripts. In
    every case the folded word is one of the words the old choice could take (checked
    mechanically, 0 exceptions); the inputs have no knob, so the choice was already constant;
  - `labeldown` / `labelup` -> `label_down` / `label_up`: 3; a named cell address: keltner;
  - the `vw-hs1-enum-na` probe (M3, above); candlestick-patterns-on-backtest (below); tree
    renumbering only: 1.
- **Drawings lost against master: 5 scripts, each withheld by name with the evidence above**:
  stop-loss-clustering 19 -> 17, volume-footprint 27 -> 20, sector-rotation fixture 10 -> 3 and
  dynamic-S&R 94 -> 81 (integer point sizes, m4); candlestick-patterns-on-backtest 2 -> 0 (its
  table position comes from `locNsze`, which reads `str.split` and a loop: not readable before bar
  0, and master drew it at the default). None of the five reaches a drawing through the member
  door on master either.

### Rails the review fixes moved (each updated with its reason written in)
- `honestySweep` item 1: a helper over an input only a drawing reads is folded at the default, so
  the I6b-N2 shape (no default arm, uncovered options, default "A") is now drawn `dashed`, as
  TradingView does (master drew it solid, the last push withheld it); the covered and default-arm
  cases pin the word instead of the per-bar `if` over a constant. The `na` cases (default on an
  uncovered option, two subjects, a named argument) are still withheld.
- `switchValueForms`: same reading; its runtime-lane scripts carry a `plot`, because a drawing with
  every word read before bar 0 has no per-bar expression left and the object lane needs one output.
- `c45NamedInputDefaults`: atr-bands' table is drawn at `bottom_right` (was withheld).
- `tableCellSetters`: an unreadable `cell_set_text_formatting` withholds its table (M3).
- `capRound4`, `f4SpyDrawings`: back to master's text; auto-trendline's `extend` is read, so its
  lines are withheld only for the lost removal (`pine:object-removal-lost`).
- `pineProbeReplay`: artemis 731 -> 644 and htf-liquidity 921 -> 836 Resolvers (per-bar choices no
  longer resolved); plot outputs byte-identical (census `outHash`).
- `runtimeDocumentRoundTrip`: fixture re-written with `RF_WRITE_FIXTURE=1`; inside-bar-range's line
  style is the folded `solid` (its input's default) instead of an `if` chain.
- `tools/corpus_metric.json`: the one m5 row above.

### Objects v2, part 3 (152 captures)
| | MATCH | DIVERGE | INCONCLUSIVE |
|---|---|---|---|
| master `eec65fb779` | 69 | 41 | 15 |
| last push `3793f7b336` | 75 | 35 | 15 |
| this head | 75 | 35 | 15 |

- Against master: the six named captures DIVERGE -> MATCH, plus htf-liquidity-rddt's lines family.
- Against the last push: no capture and no family changes verdict.
- **0 captures and 0 families move away from TradingView.** v1 unchanged: 79 / 31 / 15.

### Mutants, part 3 (`engine51ReviewFixes.test.js`, 31 rails; restore from the copy, hash == HEAD blob, all true)
| id | mutant | result |
|---|---|---|
| C0 | none | 31/31 green |
| R1 | the static reader off | RED 10 |
| R2 | switch arm keys read as literals only | RED 3 |
| R3 | a helper whose body is a switch not followed | RED 4 |
| R4 | an un-reassigned top-level `var` not read | RED 1 |
| R5 | a hung `var` switch not read | RED 2 |
| R6 | a block `var` not read | RED 1 |
| R7 | a named input default not followed | RED 1 |
| R8 | the per-bar choice not lifted out of a helper | RED 1 |
| R9 | a setter's unreadable size keeps the object | RED 1 |
| R10 | a cell patch's unreadable size keeps the table | RED 1 |
| R11 | point sizes not detected | RED 4 |
| R12 | the no-output headline without the withheld drawing | RED 1 |
| R13 | positional-after-named not refused (M4) | RED 1 |
| R14 | too many arguments not refused (M11) | RED 1 |
| R15 | host: the one-property any-name rule restored (M9) | RED 1 |
| R16 | runtime: the same | RED 1 |
| R17 | a wrong Pine name in the table (`box.set_bgcolor` -> `bgcolor`) | RED 3 |
| R18 | host: a setter's property name accepted as its parameter (L7) | RED 1 |
| R19, R20 | enum members not values / `input.enum` default not read | RED 2, 2 |
| R22 | an enum-typed parameter read as two parameters | RED 1 |
| R23 | `true` (the parser's 1) not read as a boolean | RED 1 |
| R24 | a block-local `x = switch` not read | RED 1 |
| R25 | enum members not read off the folded header | RED 2 |
| R26 | a declared knob folded at its default | RED 1 |
| R4b | `neverReassigned` always true | **survives** |

- R4b survives every shape tried (a reassigned top-level `var`, a reassigned `var` switch, a block
  `var` reassigned in a nested block): the value lane rebinds a reassigned name, so the reader
  meets a different binding (or the scope's own) before this check. It stays as a second guard on
  a mutable name, recorded as not provable by any input found.
- A top-level `input.enum` map added during the work was never load-bearing (mutant survived; the
  binding is an expression the reader already follows), so it was deleted rather than kept.
- `engine51ObjectFixes` (14 rails): C0 green; N1-N8 RED (7, 2, 1, 1, 3, 1, 2, 1). N6 (the text
  reader's `objectLane` door) had become redundant for its old rail once the static reader read
  ict-killzones' size first; a new rail (the same helper on `timeframe.period`) proves it again.
- `cellPositionalOrder`: M1-M4 RED (4, 1, 1, 4).

### Runs, part 3
- hostParity: `--check` HP-1 GREEN 166/166; `--write` moved no digest; `--mutation-control` HP-4
  GREEN (35 red).
- `service_smoke.json` re-recorded against a local engine-51 service: identical (digest
  `cf5a5f024e30`), not re-committed. Plain smoke PASS.
- Heavy run (`ast`, `runtime/__tests__`, `__tests__`, and now `builder`): ONE heavy-lock run on `5086e201af`:
  1,123 files, **19,521 passed, 2 failed, 199 skipped**. The 2 are the master reds `rsRatingDef` /
  `rsVsEmaDef` (#1136), red on master `eec65fb779` too (checked), not touched here.

