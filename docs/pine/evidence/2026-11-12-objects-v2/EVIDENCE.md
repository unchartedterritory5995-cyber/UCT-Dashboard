# Vendor harness: objects v2, every paired record graded field by field

Branch `tools/vendor-harness-objects-v2`, on master `fecbf19fb6` (engine 50). Tooling only: no
engine file changes and no engine bump. Slice S1 of the drawing-objects lane.

## Why
v1 (`compare.mjs::compareObjects`) grades a drawing by its counts, its texts, and (since C44) the
colours of objects it pairs BY VALUE. It never asks where a drawing is. A line at the wrong price
pairs with nothing, is filed `unpaired`, and the family still grades MATCH when the counts and
texts agree.

## What the capture holds (read off `tv_capture.js::readGraphics` and the 152 captures)
`readGraphics` stores TradingView's `_primitivesDataById` verbatim. Keys seen, per family:

| family | graded | not graded (named) |
|---|---|---|
| lines | `y1 y2` (price), `ex` extend, `st` style, `w` width, `ci` colour | `x1 x2`, `fo` |
| labels | `y` (only at `yloc.price`), `yl` yloc, `t` text, `st` style, `sz` size, `ta` textalign, `tt` tooltip, `ci` colour, `tci` text colour | `x`, `fo` |
| boxes | `y1` top, `y2` bottom, `ex`, `st` border_style, `w` border_width, `t`, `ts`, `tha`, `tva`, `tw`, `c` border colour, `bc` bgcolor, `tc` text colour | `x1 x2` |
| tables | `pos`, `cols`, `rows`, `frmw`, `brdw`, `bgc`, `frmc` (if framed), `brdc` (if bordered) | |
| tableCells | `t`, `tha`, `tva`, `ts`, `tt`, `tf` font, `tc`, `bgc` (paired by `tid`/`col`/`row`) | `w`, `h` (null on all 702 records), `colspan`, `rowspan` |
| linefills | `ci` (paired by `line1`/`line2`) | |

**x is not graded anywhere.** The capture's `x`, `x1`, `x2` are small integers (0 to a few
hundred on an 1,800-bar chart; `vw-object-gc-a`: the label at bar 8256 has `x = 1`). They are an
index into a coordinate table the capture does not record, not a bar index or a time. Every v2
report names `x`, `xloc` and the other fields above in `ungraded`. A rank hypothesis (the index is
the rank of the distinct x values) was probed on 93 captures and not adopted: 5 agreed fully, and
the misses (e.g. artemis: ranks off by one) leave the table's rule unknown. Grading x needs the
capture to record the table (a `tv_capture.js` change and new captures).

## How it pairs and grades (`vendorHarness/objectRecords.js`, `compare.mjs::OBJECTS_V2_FIELDS`, `compareObjectsV2`)
- lines, labels, boxes: both sides by id (creation order), aligned at the NEWEST end (when counts
  differ the object limit took the oldest). Extra records are unpaired: a count difference, never
  graded field by field.
- tables by creation order; cells by (paired table, column, row).
- linefills by their two lines, mapped through the line pairing (Pine keeps one fill per pair;
  pairing by creation order misaligned every fill after a re-created one on liquidity-pools).
- price fields: `valuesAgree` under the capture's tolerance (`tolerancePolicy`). Numbers,
  enums and text: exact. Colours: the C44 reading (theme-relative not graded).
- An unset property is compared as what is drawn: Pine's default where the table states one,
  else the render state's default (`objectDefaultsFor`). Cell `text_size` default is `auto`,
  WITNESSED (k-clustering: 8 cells with no size, recorded `auto`; the reference says `size.normal`,
  and our renderer draws both at 12 px).
- Text-placement fields of an empty text are not graded (nothing is drawn to place).
- An object drawn by NEITHER side (an `na` coordinate on both) is graded on its coordinates only
  (the C44 ruling).
- Vendor codes: only codes WITNESSED on paired records are decoded (each one met only that value of
  ours in the re-grade). `cir`, `ab`, `al` and extend `l` are left out on purpose; an unknown code is
  `undecoded`, counted, neither agreeing nor differing. 0 undecoded in the re-grade.
- A family v1 found withheld by name (`counts[].withheld`) is not paired again; cells go with
  tables, fills with lines.
- Diagnostic only: when a family differs, it is re-paired with equal ids first. If every field then
  agrees, the report says `ONLY in creation order` (`differsOnlyByCreationOrder`); the verdict stays
  DIVERGE.

## Verdicts and ratchets
v2 is a SEPARATE report. `compareCapture`, `verdict.verdict` and every ratchet keep reading v1;
`harness.js::gradeCapture` returns `objectsV2` beside the verdict, and `runHarness` adds it to each
result (so `verdicts.json` gains an `objectsV2` field when written). v2 never makes a v1 DIVERGE or
INCONCLUSIVE better; it can only turn a v1 MATCH into DIVERGE. No ratchet was touched or loosened.

## Re-grade: every capture with object records, ours vs TradingView, master `fecbf19fb6` + this branch
`objectsV2Regrade.measure.test.js` (opt-in), production lane (objects-only pane armed, runtime
pane dark), 152 captures, 0 errors.

| | MATCH | DIVERGE | INCONCLUSIVE |
|---|---|---|---|
| v1 | 79 | 31 | 15 |
| v2 | 69 | 41 | 15 |

(152 rows; 27 are not graded on objects by v1 either way.)

Per family (a family counts where v1 or v2 gave it a verdict):

| family | v1 MATCH | v1 DIVERGE | v2 MATCH | v2 DIVERGE |
|---|---|---|---|---|
| lines | 88 | 1 | 87 | 2 |
| labels | 89 | 0 | 85 | 4 |
| boxes | 91 | 2 | 91 | 2 |
| tables | 95 | 0 | 95 | 0 |
| tableCells | 82 | 13 | 78 | 17 |
| linefills | (not graded) | | 5 | 2 |

### Captures v1 grades MATCH that v2 grades DIVERGE (10), with the first differing field
| capture | first difference | what it is |
|---|---|---|
| extrapolated-pivot-connector-rddt-1d-2026-09-28 | labels `style`: vendor `label_down`, ours `labeldown` | ENGINE: `label.style_labeldown` (v4 alias) reaches the program as `labeldown`, unknown to the renderer, so the label is drawn centred with no pointer |
| extrapolated-pivot-connector-spy-1d-2026-10-03 | same | same |
| ict-killzones-pivots-tfo-rddt-1d-2026-09-28 | tableCells `text_size`: vendor `small`, ours unset (`auto`) | ENGINE: `text_size = data_size` (an input) is not carried; cells drawn at the default size |
| ict-killzones-pivots-tfo-spy-1d-2026-10-03 | same | same |
| keltner-center-of-gravity-channel-rddt-1d-2026-09-30 | tableCells `count` (3 vs 3, one unpaired each side) | ENGINE: `table.cell(width, row=1, column=0, …)` is placed at (1,0) on ours, (0,1) on TradingView: a named address is read positionally |
| keltner-center-of-gravity-channel-spy-1d-2026-10-03 | same | same |
| liquidity-pools-spy-1d-2026-10-03 | linefills `count`: vendor 504, ours 252 | held fills differ (the rddt capture matches); cause not established |
| price-action-as-in-book-fibonacci-supportresistant-trendline-spy-1d-2026-10-03 | linefills `count`: vendor 261, ours 49 | held fills differ; cause not established |
| vw-call-site-history-rddt-1d-2026-10-01 | labels `text` (A12 vs A11) | ONLY creation order: TradingView re-created A11 later (id 59); paired by equal ids every field agrees |
| vw-call-site-history-spy-1d-2026-10-01 | same | same |

Also a family moving MATCH -> DIVERGE inside a capture v1 already grades DIVERGE:
`htf-liquidity-dashboard-tfo-rddt-1d-2026-09-28` lines `style`: vendor `dotted`, ours `solid`.

### Field-level differences on paired records (whole re-grade)
Price coordinates agree on 4,066/4,394 line y1 (all 328 differences on one v1-DIVERGE capture),
1,591/1,597 box tops and bottoms, 3,710/3,714 label y at price. Code tables, measured: every
decoded code met only its own value of ours (e.g. label style `ldn` -> `label_down` 1,651 agree,
`none` 1,766, `label_up` 658, `label_center` 228, `label_left` 55, `label_right` 11; line style
`dotted` 1,565, `dashed` 658, `arrow_right` 69; the only disagreements are the defects above, plus
`monospace` cell font (34, ours never carries `text_font_family`) and box text placement on
v1-DIVERGE captures).

## Rails and mutants
`vendorHarness.objectsV2.test.js`. Harness: copy, edit, run, restore FROM THE COPY, `git
hash-object` == HEAD blob (all true).

| id | mutant | result |
|---|---|---|
| C0 | none (control) | 18/18 green |
| MB1 | price fields always agree | RED 3 |
| MB2 | an unknown vendor code reads `agree` | RED 1 |
| MB3 | `x1` dropped from the not-graded key list | RED 1 (key-coverage rail) |
| MB4 | align at the OLDEST end | RED 1 |
| MB5 | v2 never turns a v1 MATCH into DIVERGE | RED 4 |
| MB6 | a linefill pairs with any unused vendor fill | RED 1 |
| MB7 | a key missing from the record read as the default | RED 1 |
| MB8 | unpaired records are not a difference | RED 3 |
| MB9 | every difference flagged "creation order only" | RED 1 |
| MB10 | cell `text_halign` graded on an empty cell | RED 1 |
| MB11 | an unset property with no table default compared as unset (not the render default) | RED 1 |
| MB12 | a withheld family paired again | RED 1 |
| MB13 | fills not withheld with their lines | RED 1 |

## Runs
- `vendorHarness.objectsV2.test.js`: 18 tests green.
- The whole `__tests__/vendorHarness` folder in one heavy-lock run (head `822d929305`, before the
  last one-line rule `fills withheld with their lines`): 129 files, **1,649 passed, 31 skipped,
  0 failed** (108 files passed, 21 skipped).
- After that rule: the re-grade again (numbers above, unchanged except linefills v2 DIVERGE 4 -> 2,
  both k-clustering, whose lines v1 withholds) and `objectsV2`, `vendorHarness`, `c44ColourVerdict`,
  `c37ObjectColours`, `corpus` test files: 5 files, 137 tests green.
- Re-grade: `cd app && PINE_OBJECTS_V2=1 PINE_OBJECTS_V2_OUT=<dir> node node_modules/vitest/vitest.mjs
  run src/components/chart/engine/__tests__/vendorHarness/objectsV2Regrade.measure.test.js
  --maxWorkers=1` (152 captures, about 100 s).

## Follow-ups (not in this PR)
- Engine: named cell address read positionally; v4 `style_labeldown`/`style_labelup`; a computed
  cell `text_size` not carried (ict-killzones); `text_font_family` not carried (34 monospace cells);
  liquidity-pools-spy and price-action-spy hold far fewer fills than TradingView.
- Capture: record TradingView's x coordinate table so x/xloc can be graded.
- Once those are understood, decide whether v2 joins the verdict (owner call; it is a report today).
