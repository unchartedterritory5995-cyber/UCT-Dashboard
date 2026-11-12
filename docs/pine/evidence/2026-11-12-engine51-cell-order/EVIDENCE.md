# Engine 51: `table.cell` positional order matches Pine

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
