# Engine 52: serve, never default

Branch `fix/pine-engine52-serve-never-default`, cut from `fix/pine-engine51-cell-order` (`c7bb897165`,
engine 51, PR #1149, not yet on master when this was written). Drawing-objects lane.

## ⛔ STOP ITEM (reported for the coordinator's ruling)

**uncharted-volume-v2's Range table loses its ATRx cell** (vendor `fillText` captures SPY and AGEN,
`pineTableVendorParity`, `memberPaneTables`):

- The cell's `text_color` is `atrMultColor`: `color atrMultColor = color.white`, then inside
  `if show_atr_ext_from_sma and …` it is reassigned to `absMult <= 7 ? color.white : absMult <= 10 ?
  color.yellow : color.red`, where `absMult` is a block local. No colour reader follows that (the
  test on a block local is not readable in the colour lane; the text lane serves the cell's TEXT).
- Engine 51 drew the cell with its colour DROPPED, so at the renderer's default ink. Its text was
  byte-identical to TradingView (`| ATRx: 0.92` on SPY); the capture records text, not colour.
- Engine 52's rule withholds it by name (`pine:prop-unreadable`), so the capture's drawn cells go
  3 -> 2 (the remaining two still byte-identical). The rails were updated with the reason written in
  (`pineTableVendorParity`, `memberPaneTables`, `memberPaneDefinition` "10 of 18" -> "11 of 18").
- This is the same shape as engine 51's Volume-table ruling (a capture-backed drawing withheld
  because one of its props was drawn at the default). The two rules in the brief conflict here
  ("never at the default" vs "no capture moves away"), so it is reported, not decided.
- What would serve it: reading a colour choice whose test is a block local in the binding's own
  scope (tried for the `bound` path; the colour's ternary still does not resolve there).

No objects-v2 capture moves (below); the cell above is not an objects-v2 capture.

## 1. v6 integer point text sizes: SERVED

- Host lane (`pine.js` `valueRef`): a `size` / `text_size` the static reader reads as a number
  (literal, `input.int`/`input.float` default, a name bound to one, arithmetic) is carried as
  `{v:'const', value: n}`. A negative one is withheld (`enum:unreadable`); a number the reader
  cannot read before bar 0 is still withheld as `enum:points`.
- Runtime lane (`runtime/objectStore.js` `propValue`): a finite number >= 0 in `size` / `text_size`
  is carried as that number (it used to throw "takes a constant").
- Renderers (`objectCanvas.js::textSizePx`, used by labels, label glyphs, box text and
  `objectTableDom.js` cells). **Source of every number**: the Pine v6 reference, verbatim in
  `docs/pine/pine-presentation-spec.md` 4.3.1 and C115:
  - labels: `size.auto` 0, `tiny` ~7, `small` ~10, `normal` 12, `large` 18, `huge` 24;
  - boxes and tables: 0 / 8 / 10 / 14 / 20 / 36.
  The reference says an int and the word it equals are the same size, so an int is drawn on the
  scale the words already use here (`TEXT_SIZE_PX`, `SHAPE_PX`): at an anchor, exactly the word's
  pixels; between anchors, linear; past `huge`, proportional to `huge`; 0 is `auto`.
- **No capture witnesses a point size's pixels** (every capture records `ts` / `sz` as words:
  4,382 `sz: normal`, 2,375 `ts: auto`, … and no number). The objects-v2 grader marks an int size
  `pointSize`, a NOT-GRADED state (`objectRecords.js::fieldRow`, `compare.mjs::V2_NOT_GRADED`).
- Census: engine 51 withheld 29 point-size slots (`enum:points`); engine 52 withholds **0** for
  that reason. **16 slots in 3 files are served** (sector-rotation fixture: 7 cells drawn;
  dynamic-S&R; volume-footprint). The rest of the 29 sit in drawings now withheld for a different,
  named prop (stop-loss-clustering 2: per-bar `expCol`; volume-footprint cells: a `bgcolor` from
  `color.new(colMetricText, 20)` it cannot read).

## 2. Non-enum props drawn at the default: 0 left

`dropProp` (drawn at the default) has **no caller**. A colour, width, count or tooltip the door
cannot read now withholds its drawing by name: `ENUM_DROPS.value` (`pine:prop-unreadable`, drop
`prop:unreadable`), read by the create and cell converters; a cell patch withholds its table
(`contentLost`, the M3 rule). `objectLoss.js`, `editorStatus.js`, `EDITOR-STATUS-PANEL-SPEC.md`
section 4 carry the reason.

Serving first, through the engine-51 static reader generalised (`staticEnumValue` now answers
`{n}`, `{hex}`, `{arr}`, `{obj}` beside `{s}`, `{b}`, `{w}`):

- numbers, unary minus, `+ - * /` (division folded only where int and float division agree),
  `< > <= >=`, `==`/`!=` by kind, `math.max/min/abs`;
- `input.int` / `input.float` / `input.bool` / `input.color` defaults, v4 `input(<value>)` and
  v4 `input(…, type = input.integer)` (fvg: `color.new(color.black, boxTransparency)`)
  (C16; a member's knob is still left to the per-bar reader, `isKnob`);
- C44 colours: `color.new(c, t)` and `color.rgb(r, g, b[, t])` painted by the object runtime's one
  formula (`withObjectTransparency`); C46 `color.from_gradient` by the runtime's own measured
  blend (`fromGradient`); Pine colour constants by the palette;
- the script's own types: `T.new(…)` (positional or named) and `x.field`;
- a `bound` binding (a default reassigned in an `if`) followed by the colour reader exactly as
  the text reader follows it;
- the colour reader asks the static reader whenever its own readers answered nothing, so an ARM of
  a per-bar choice (`stDir < 0 ? theme.bull : theme.bear`) is read the same way.

Per class, 1,605 files, base engine 51 (`c7bb897165`) vs head (sites = unique `family.prop@line`):

| prop | sites | served | withheld | still at default |
|---|---|---|---|---|
| cell.bgcolor | 217 | 134 | 83 | 0 |
| cell.text_color | 156 | 4 | 152 | 0 |
| cell.tooltip | 20 | 10 | 10 | 0 |
| label.textcolor | 14 | 11 | 3 | 0 |
| table.border_color | 11 | 9 | 2 | 0 |
| table.frame_color | 10 | 9 | 1 | 0 |
| label.color | 9 | 6 | 3 | 0 |
| line.color | 6 | 4 | 2 | 0 |
| table.rows | 5 | 2 | 3 | 0 |
| table.bgcolor | 5 | 4 | 1 | 0 |
| line.width | 3 | 3 | 0 | 0 |
| table.columns | 2 | 0 | 2 | 0 |
| label.tooltip | 2 | 1 | 1 | 0 |
| cell.width | 2 | 0 | 2 | 0 |
| linefill.color | 1 | 0 | 1 | 0 |
| **total** | **463** | **197** | **266** | **0** |

(The census counts 463 / 44 files where engine 51's note said 453 / 38: `line.width` and a few
`table.*` rows are counted here too.) Plus 6 slots newly withheld that engine 51 never reached
(volume-footprint `cell.bgcolor`, behind an engine-51 point-size withhold).

⛔ **A name the script reassigns is never read as its declaration** (found by this work, railed):
the scope can hold a declaration's binding for a name a later `:=` moves (C28: artemis's
`knnVal = 0.0`, written in the kNN loop). With numbers readable, an intermediate build folded
`knnVal > 0 ? …` off the declaration and drew `◈ NEUTRAL` where TradingView draws `▼ BEAR`
(`w3CapturedCells`). The static reader now refuses a name in the script's reassigned set
(`mutableNames`); delta-imbalance's two header cells (`color.new(tiltTint, 72)`, `tiltTint`
reassigned) are withheld for the same reason.

Examples served: ict-killzones `kz1_color = input.color(color.new(color.blue, default_transparency))`
with `var default_transparency = 60` -> `#2962FF66` (corpus + 2 captures); multicator-table's
`theme.frame` / `theme.tableBg` / `theme.bull` from `ThemePalette.new(…)` (corpus + 2 captures:
2 tables, 2 labels and 52 of 63 cells served; 11 cells withheld); auto-trendline `width =
lnwidth_recent` (corpus + 2 captures).

Examples withheld (each a named capability gap):

- **theme-conditional colour**: a choice on `chart.bg_color`'s brightness (`isDark = switch themeInput
  … => color.r(chart.bg_color) < 128`, `darkUI`), liquidity-pools-pro, mirage-liquidity-sweep,
  rsi-levels-regime-map, volume-surge-radar (most of the 152 `cell.text_color`). Serving it needs a
  colour node resolved against the chart's theme at paint, like C37's `chart.fg_color` reference.
- **a colour variable reassigned per bar** (delta-imbalance `tiltTint`) (`var color C_TXT = na` then `:=`; dynamic-S&R) or a
  block-local test (the ATRx STOP item).
- **a row / column count from a collection** (`matrix.rows()`, `array.size()`, `totalRows` built
  in a loop): performance, seasonality, candlestick-patterns, fibonacci-statistics, heat-map lag meter.
- **a tooltip only the runtime holds** (luxy's per-bar tooltips, `syminfo.description`).
- **`chart.fg_color.transp(50)`** (a method form on a theme reference; volatility-trend-score).

## 3. `str.*` folding and bounded helper loops (served for text; NOT for an enum slot)

The static reader folds `str.lower`, `str.upper`, `str.replace` (the Nth occurrence),
`str.replace_all`, `str.split` (to a list; an empty piece is not folded), `str.contains`,
`str.startswith`, `str.endswith`, `str.length`, `str.tostring` (a string, or a whole number only:
no number format), `array.get` / `array.size` over such a list, and RUNS a script helper whose body
is statements (`staticHelperBody`: locals, `:=`, `+=`, `for … to … [by …]`, `if` / `else`, last
expression), bounded at 1,000 loop passes. The folds serve TEXT (a tooltip, a cell text) and booleans in
conditions.

⛔ **A folded string that SPELLS a constant's word is not served in an enum slot.**
`vendorHarness.c47PositionSize` pins C47's rule: "an `input.string` whose default is typed text
(`bottom_right`) is dropped: no capture shows that spelling". A computed spelling is the same
unwitnessed case. So candlestick-patterns-on-backtest's `locNsze(tablePos)` folds to the string
`middle_right` (railed through a tooltip) but its table stays withheld by name
(`enum:unreadable`; also `table.columns = matrix.columns(rtnMtx)`). Gap: a capture of a position
given as a string.

## 4. C31 block-run proof for uncharted-volume-v2's Volume table: NOT served (two named gaps)

Tried and reverted (not in this branch):

- Treating a C31 block local in the object lane like the `var` form (C48): read the every-bar way
  and noted with its block's guard (`stateRunSink` -> `program.blockRuns` -> `objectColumns`
  withholds on a chart where the block runs after a skip). The translation then carried the
  position `if(hasRecentHV) top_center else top_right`, gated on `not skipAll and isDaily`.
- **Gap 1, budget**: that condition's tree measures a lookback of **3,001** bars (`ta.highest(volD[1],
  lookbackBarsHVE)` and the latch on it) against the object reader's cap of **960**, so it fails at
  bind (`budget:lookback`).
- **Gap 2, a runtime defect found doing it**: with that tree failed, the table was still DRAWN, at
  the `else` arm (`top_right`). An `if` text in an enum slot whose condition node failed is read as
  false rather than holding the drawing. That must be fixed before the gate path can be enabled.
  It is not reachable on this branch (the C31 refusal stands, so no such tree is emitted).
- The block-run argument itself holds: `skipAll = isRatioSymbol or not (ta.cum(nz(v)) > 0)` is
  bar-invariant after the first bar with volume, `isDaily` is a chart constant, so on SPY / AGEN 1D
  the block runs on every bar and the every-bar `ta.highest` is TradingView's.

`memberPaneDefinition.test.js` reads "11 of 18" (the ATRx cell, above), not "10 of 18".

## Census (1,605 files: corpus 266, repo .pine 573, vendor captures 353, licence-held sample 413)

Base engine 51 `c7bb897165` vs head, sources read from one tree, canonical (key-sorted) hash.

- 58 rows change, **0 in key order only**, 0 new translation errors.
- Newly served drawings: 10 rows (black-scholes +2 cells, support-and-resistance-step-4 +2,
  elliot-wave-detector, sector-rotation fixture +7 cells (point sizes), volume-footprint,
  cross-correlation +1, multicator-table corpus + 2 captures: tables, labels and 52 cells).
- Withheld (each by `pine:prop-unreadable`; each was drawn with a prop at the default): 26 rows +
  1 both: delta-imbalance, delta-volume-columns, dual-supertrend, dynamic-S&R, fibonacci-statistics,
  heikin-ashi-supertrend, liquidity-pools-pro, heikin-ashi lag meter, vix-term-structure, luxy,
  machine-learning-supertrend, market-structure-trend-targets, volume-surge-radar,
  rsi-levels-regime-map, mirage-liquidity-sweep, performance, rsi-multi-timeframe-dashboard,
  seasonality, strong-knn, supertrendrange, trend-levels, volatility-coil-edge,
  volatility-trend-score. None has a vendor capture except as listed below.
- Other: 21 rows with the same op counts and a changed program (a colour or width now read where
  it was dropped, or the `bound` colour now followed).
- Captures that change their program: artemis (2), auto-trendline (2), black-scholes (1),
  htf-liquidity-dashboard (2), ict-killzones (2), multicator-table (2). Objects v2: no verdict or
  family moves for any of them (below).

## Objects v2 re-grade (152 captures), base vs head

| | v1 M / D / I | v2 M / D / I |
|---|---|---|
| engine 51 `c7bb897165` | 79 / 31 / 15 | 75 / 35 / 15 |
| engine 52 head | 79 / 31 / 15 | 75 / 35 / 15 |

Per family unchanged (lines 88/1, labels 87/2, boxes 91/2, tables 95/0, tableCells 82/13,
linefills 5/2). Per capture: **no row of the re-grade changes at all** (final head; an
intermediate build paired a 17th artemis cell whose text was wrong, which the C28 fix removed).
**0 captures and 0 families move away.**

## Mutants (`engine52ServeNeverDefault.test.js` 15 rails + `pineTableVendorParity`, then `rt5RuntimeObjects`)

Copy, edit, run, restore FROM THE COPY, `git hash-object` == `HEAD:` blob (all true).

| id | mutant | result |
|---|---|---|
| C0 | none | 49/49 green (31/31 for the second set) |
| M1 | point size served -> withheld | RED 1 |
| M2 | renderer ignores an int size | RED 1 |
| M3 | create: unreadable prop drawn at default | RED 1 |
| M4 | cell: unreadable prop drawn at default | RED 8 |
| M5 | cell patch dropped, table kept | RED 1 |
| M6 | `color.new` transparency ignored | RED 2 |
| M7 | type field not read | RED 1 |
| M8 | (the string-as-word fold it guarded was removed, C47) | n/a |
| M9 | helper body not run | RED 1 |
| M10 | colour reader without the static fallback | RED 2 |
| M11 | `bound` colour not followed | RED 1 |
| M12 | number literal not read | RED 4 |
| M13 | v2 grader grades an int size | RED 1 (rail added) |
| M14 | runtime lane rejects an int size | RED 1 (rail added) |
| M16 | a reassigned name read as its declaration | RED 4 (`w3CapturedCells.vendor` + `vendorHarness.c28StaleSnapshot`; a synthetic rail did not discriminate and was not kept) |
| M15 | runtime: unserved CELL colour not held | survived -> the path it guarded (runtime colour on a cell) was unreachable from any input found, so both halves were **deleted**, not kept |

## Runs

- Focused (5 files or fewer per run): `engine52ServeNeverDefault`, `engine51ReviewFixes`,
  `pineTableVendorParity`, `memberPaneTables`, `memberPaneDefinition`, `rt5RuntimeObjects`: green.
- hostParity: `--write` moved only `digest` and `script_engine` (51 -> 52), 166 cases; `--host node
  --check` HP-1 GREEN 166/166; `--mutation-control` HP-4 GREEN (35 red).
- `service_smoke.json` re-recorded against a local engine-52 pine-runtime service (Node 20, the
  Dockerfile's permission flags, a throwaway in-memory secret): `--record` PASS, plain smoke PASS
  (engine 52, canary green, run digest `b5f203f30c16`, unsigned POST 401).
- Heavy run (ONE heavy-lock run on the final head: `ast`, `runtime/__tests__`, `__tests__`,
  `builder`, `--maxWorkers=1`): 1,124 files, **19,535 passed, 2 failed, 199 skipped**; 3 files
  failed: the master reds `rsRatingDef` / `rsVsEmaDef` (#1136), and `PineBox.editor.test.jsx`, a
  collection error `ENOSPC: no space left on device` (the disk was at 96%); it passes alone (5/5).
  An earlier heavy run on an intermediate head is what found the artemis C28 wrong cell and the
  fvg v4 `input.integer` withhold, both fixed and railed above.
- objects-v2 re-grade and HP-1 re-run on the final head: unchanged (above), HP-1 GREEN 166/166.
- Engine 51 (#1149) was not on master when this was pushed, so master was not merged in.
