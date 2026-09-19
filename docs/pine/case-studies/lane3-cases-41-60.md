# Lane 3 — Visual complexity case studies, ranks 41–60

**Authority:** READ_ONLY_RESEARCH. **Date:** 2026-09-08.
**Target platform:** Lightweight Charts **v5.2.0** (per `lane5a-lwc5-core.md`; 5.2.1 exists and is not adopted).
**Plugin vocabulary:** `lane5b-lwc5-plugins.md` — series primitive (`ISeriesPrimitive`), pane primitive
(`IPanePrimitive`), custom series (`ICustomSeriesPaneView`), the four paint slots
(`'bottom'` · `'normal' + drawBackground` · `'normal' + draw` · `'top'`), `hitTest` →
`PrimitiveHoveredItem`, `autoscaleInfo`, `updateAllViews` / `requestUpdate`,
`useBitmapCoordinateSpace` / `useMediaCoordinateSpace`, `positionsBox` / `positionsLine` / `fullBarWidth`.

All twenty sources were read in full. Machine-readable per-script records are in
`lane3-cases-41-60.json`; this file carries the cross-cutting findings.

---

## 1. Snapshots

Four of twenty snapshot PNGs are present on disk; the other sixteen were never downloaded (the
`snap_manifest.json` names them, the files do not exist under `acq/snapshots/`). Every
`snapshot_url` is recorded in the JSON regardless.

| rank | snapshot_url | file |
| --- | --- | --- |
| 41 | https://www.tradingview.com/i/95Wwe7ry/ | **present** |
| 42 | https://www.tradingview.com/i/p9qM6rTh/ | missing |
| 43 | https://www.tradingview.com/i/AcNWmGMV/ | missing |
| 44 | https://www.tradingview.com/i/fyQWNw7E/ | **present** |
| 45 | https://www.tradingview.com/i/aaPsyqft/ | missing |
| 46 | https://www.tradingview.com/i/GUCWo6S9/ | missing |
| 47 | https://www.tradingview.com/i/CL9xqMm2/ | missing |
| 48 | https://www.tradingview.com/i/4rlNNL5e/ | missing |
| 49 | https://www.tradingview.com/i/rqB1Q4ON/ | missing |
| 50 | https://www.tradingview.com/i/yu7YSQnd/ | missing |
| 51 | https://www.tradingview.com/i/fq4wSUev/ | **present** |
| 52 | https://www.tradingview.com/i/fm7TWJSE/ | missing |
| 53 | https://www.tradingview.com/i/sy6NN7eu/ | missing |
| 54 | https://www.tradingview.com/i/zTQCyFNk/ | missing |
| 55 | https://www.tradingview.com/i/bOdqA7m9/ | missing |
| 56 | https://www.tradingview.com/i/sevQh9oE/ | missing |
| 57 | https://www.tradingview.com/i/F7vanoEc/ | missing |
| 58 | https://www.tradingview.com/i/aoOTZ7VY/ | missing |
| 59 | https://www.tradingview.com/i/F2vJnCdI/ | **present** |
| 60 | https://www.tradingview.com/i/pjQDnqCf/ | missing |

The four available images each **confirmed** the reconstruction rather than changing it:

- **41** — FVG band, `Sell` pill, dashed TP/SL bracket with pill labels, x-cross TP mark, 2×10 table.
- **44** — the panel and speedometer are drawn **past the last bar**, in what would be Jul/Aug/Sep
  whitespace, with the vertical letter stacks (`R`/`S`/`I` …) exactly as the source implies.
- **51** — full-pane vertical session rules (the `extend.both` idiom), `3-4 AM / NY` captions at the
  top of the pane, grey/teal FVG bands, red rails running right until touched.
- **59** — smooth quarter-ellipse arcs, dashed tangents extended to both chart edges, `B` pills.

---

## 2. Difficulty histogram

```
1  ──                                   0
2  ──                                   0
3  ██████                               6   ranks 45, 48, 49, 52, 59, 60
4  ██████████████                      14   ranks 41, 42, 43, 44, 46, 47, 50,
                                            51, 53, 54, 55, 56, 57, 58
5  ──                                   0
```

**Scale-application rule used, stated so the numbers are reproducible:** a reusable DOM-overlay table
shell — the pattern the official `tooltip` and `accessibility` plugins use — is one shared component
built once, not a per-script coordinated layer, and on its own it does **not** push a case from 3 to 4.
What pushes a case to 4 is three or more genuinely distinct render layers, a custom series, or a
label-placement / text-layout engine we must author.

Nothing rated 1 or 2 in this slice, and that is itself a finding: by rank 41 the corpus has left the
"a line and some markers" band entirely. Every one of these twenty scripts is in the Pine
*drawing-object* business, which LWC does not have at all.

---

## 3. Infeasible count: **0**

No case in ranks 41–60 is infeasible. This matches lane5b's verdict on its six hard visuals —
*"No fork is required for any of the six"* — and the reasoning generalises: everything here reduces to
geometry, fills, strokes and text on a Canvas2D surface that LWC hands us via
`CanvasRenderingTarget2D`, plus a DOM overlay for anything that wants selectable text.

Three things came close enough to be worth naming explicitly, with why each is *hard* rather than
*missing*:

1. **Tooltips on drawings** (ranks 43, 44, 54, 56). There is no tooltip API anywhere in LWC. But
   `hitTest` → `PrimitiveHoveredItem.externalId` → `MouseEventParams.hoveredInfo.objectId` is the
   sanctioned hover path in 5.2.0, and the official `tooltip` plugin builds an HTML element for the
   visible part. Cost, not capability. The one honest caveat lane5b records: on a **touch tap** the
   identified object is whatever the *previous* mouse move resolved, and whether the library
   synthesises a position update before a tap on all touch paths is **UNVERIFIED**.
2. **Viewport-driven re-execution** (ranks 42, 45, which key off
   `chart.left_visible_bar_time` / `chart.right_visible_bar_time`). This is a Pine *runtime* behaviour,
   not a renderer feature — but `chart.timeScale().subscribeVisibleLogicalRangeChange` plus
   `getVisibleLogicalRange()` gives the trigger, and deriving the visible high/low from the series data
   is ordinary work. Note the consequence: for these two scripts the whole drawing is a *function of the
   viewport*, so `updateAllViews()` must recompute the model, not just the coordinates.
3. **The Data Window** (ranks 49, 50, 54, which use `display.data_window` / `display.none` plots).
   LWC has no Data Window and no legend, so there is no destination for these at all. This is the one
   genuine *product* gap in the slice, and the correct answer is that they are values, not pixels: route
   them into the crosshair readout we already own rather than trying to render them.

---

## 4. The three hardest, and why

### 1. Rank 54 — *Multi-timeframe Harmonic Patterns* (difficulty 4)

The hardest, and it is hard for a reason no count in the inventory can show. Pine's `var` inside a
**function body is per-call-site persistent**, and each of the 25 pattern functions is itself
instantiated once per timeframe at the six call sites on lines 2175–2180. That gives up to **150
independent (pattern × timeframe) slots**, each holding roughly 12 lines, 13 labels and 2–3 linefills —
on the order of 1,800 lines and 1,950 labels against ceilings of 500, so the script *relies on Pine
silently evicting the oldest*. Eighteen patterns are on by default, so ~108 slots are live.

The geometry is easy: segments, dotted chords, and `linefill.new(lineA, lineB)` quadrilaterals. The
project is the **label layer**. Every pattern prints single-character pivot caps (X, A, B, C, D, 0, S)
and Fibonacci ratio strings at chord midpoints, and up to 108 skeletons in six colours overlap each
other. lane5b is blunt about this: the library has *exactly one* overlap resolver,
`recalculateOverlapping()` in `price-axis-widget.ts`, and it applies only to price-axis labels;
`createSeriesMarkers` supports `text` but performs no collision detection at all. So we must write the
placement pass — measure with a cached `TextWidthCache`, sort by x, greedily push vertically or drop,
cache the result and re-run only when the visible range, bar spacing, data or text changed, never
inside `draw()`. lane5b names this as *"the item most likely to be under-estimated, because 'draw text
at a coordinate' looks done after an hour and then looks wrong on every dense chart."* Rank 54 is that
sentence made concrete.

### 2. Rank 58 — *TPO IQ* (difficulty 4)

A market profile whose **geometry is text metrics**. In its historical mode the profile shape *is* one
accumulating letter string per price level (`" A B C D E"`) — the width of the measured text run is the
width of the profile row. In its current-session mode it becomes hundreds of one-bar-wide boxes, each
carrying a single letter and a four-stop `color.from_gradient` background, with a self-imposed budget
that switches the mode off above 500 TPOs.

LWC gives plugins **nothing** for text: no layout, no measurement helper, no pill, no outline, no
baseline correction (`label.style_text_outline` and numeric label sizes 2/3/7 all have to be built).
`TextWidthCache` and `makeFont` are internal and must be vendored, and its digit-normalising cache key
(`[2-9]` → `0`) is actively wrong for letter strings, so a custom `optimizationReplacementRe` is
needed. On top of that every anchor is `xloc.bar_time`, several of them **synthesized instants**
(`startTime + timeframe.in_seconds() * 1000`) that are not real bar times — and `timeToCoordinate`
returns `null` for any time not exactly on the scale, so each must go through `timeToIndex(t, true)`
first. Finally the script garbage-collects through `line.all` / `box.all` / `label.all`, a whole-script
sweep with no container and no analogue.

### 3. Rank 56 — *Dual View HTF Candlestick Patterns* (difficulty 4)

The case that best exposes the **custom-series boundary**. It draws up to ten higher-timeframe
candlesticks floating in the blank space to the right of the last bar — each **ten chart-bars wide**
with three-bar gaps, spanning roughly +20 to +150 bars — as one box (body) plus two lines (wicks), and
simultaneously redraws the same candles *in place* on the price history at their true `bar_time` spans
wherever a pattern fired.

`CandlestickSeries` is bar-slot bound. A custom series does not rescue us either: its documented
geometry model is *"one uniform-width slot per bar"*, and these are ten slots wide and live past the
last data point. So synthetic candles must be hand-drawn in a series primitive, with a hidden
whitespace `LineSeries` materialising ~150 future slots so the x coordinates resolve at all.

It also contains the single best object-management idea in the slice, and the one the mechanical
inventory is blindest to: `initialize_drawings()` runs **once** on `barstate.isfirst`, allocates the
complete pool of 10 boxes and 40 lines, and from then on the script only calls setters
(`box.set_left/right/top/bottom/bgcolor`, `line.set_x1/x2/y1/y2/color`), hiding an unused slot by
setting its colour to 100 % transparency rather than deleting it. That is exactly what an LWC layer
primitive wants — and it shows up in the inventory as `box.new×2, line.new×6`, i.e. as one of the
*simplest* scripts in the slice.

**Runners-up, for the record:** rank 44 (a speedometer, a gauge panel in future space and vertical
letter-stack text, on a `scale.none` overlay scale) and rank 42 (400 gradient rectangles rebuilt on
every pan and zoom).

---

## 5. LWC v5 gaps seen 3+ times

Counted by canonical category across the twenty cases; ranks listed.

| n | Gap (lane5a §2.11 / lane5b naming) | ranks |
| --- | --- | --- |
| **20** | **The entire Pine drawing-object layer** — `line.new` / `box.new` / `label.new` / `polyline.new` / `table.new`. LWC has three built-in visual object types: series, markers, price lines. | all 41–60 |
| **19** | **No free-floating text label**, no text inside a rectangle, no `text_halign` / `text_valign`. | all but 51 |
| **18** | **No legend / status line / value readout.** `SeriesOptionsCommon.title` feeds only the price-scale label. | all but 44, 51 |
| **12** | **No table API** — and no `table.merge_cells`, `table.clear` or `table.set_position` either. | 41,42,43,46,48,49,50,51,52,53,57,60 |
| **12** | **No time-bounded horizontal line.** `createPriceLine` is constant-price and spans the whole pane; every Pine `line.new(x1,y,x2,y)` is a gap. | 41,45,46,49,50,51,52,53,55,57,58,60 |
| **11** | **Drawing past the last bar requires materialised whitespace slots** (a hidden `LineSeries` of `WhitespaceData`, as `StockChart.jsx`'s `buildFutureWhitespace` already does). | 41,43,44,45,49,50,53,54,55,56,57 |
| **11** | **No viewport culling for primitives.** Custom series get `visibleRange`; primitives get nothing. | 42,45,46,47,48,54,55,56,58,59,60 |
| **8** | **Rich marker text** — one plain string, no font/size/colour/alignment/pill/wrap/collision. | 41,42,46,50,52,55,57,59 |
| **7** | **`plotshape` / `plotchar` glyph set.** Markers offer exactly `circle │ square │ arrowUp │ arrowDown`. Missing here: `triangleup`, `triangledown`, `xcross`, `diamond`, `labelup`, `labeldown`, and `plotchar`'s arbitrary character entirely. | 41,44,47,50,51,53,57 |
| **7** | **No `fill()` between two plots**, and no gradient fill (`top_color`/`bottom_color`). | 43,44,47,50,53,55,57 |
| **7** | **No multi-line text anywhere in the library.** The only implementation is `text-watermark/pane-renderer.ts`, which must be copied out. | 44,48,49,51,53,56,60 |
| **6** | **`timeToCoordinate` returns `null` off-scale; `logicalToCoordinate(non-integer)` returns `0` silently.** Rank 51's `plotchar` offset is a *float*. | 41,45,46,51,56,58 |
| **5** | **Line width > 4.** `LineWidth = 1│2│3│4` is a hard union on series and `PriceLineOptions`. A primitive's `ctx.lineWidth` is unconstrained, so this is a *native* gap only — state it that way. | 44,48,50,52,58 |
| **4** | **No tooltip API.** Hover is `hitTest` + `externalId` + a DOM element we own. | 43,44,54,56 |
| **3** | **Pane primitives cannot participate in autoscale** (`IPanePrimitiveBase` has no `autoscaleInfo`) — so anything that must stay in view attaches to a **series**. | 43,44,51 |
| **3** | **`bgcolor()`** — per-bar background shading has no API; it needs `drawBackground()` at `'bottom'`. | 49,53,55 |
| **3** | **No Data Window** — `display.data_window` / `display.none` plots have no LWC surface at all. | 49,50,54 |
| **3** | **No vertical line at a bar, no ray, no `extend`-left/right/both.** | 51,58,59 |
| **3** | **No trading-session, holiday or calendar model.** | 51,55,58 |

Below the threshold but worth carrying forward: **no `.all` global drawing collection** (44, 58) and
**no label collision avoidance** (54 — but see §4, it is the single most expensive item in the slice).

Two additional constraints that bit repeatedly and are structural rather than cosmetic:

- **A primitive's `autoscaleInfo` is never called if its host series has no real data point**, and
  whitespace rows do not count (the data layer filters them out of the plot list). Every "drawings
  only, at fixed y" panel — rank 44's `scale.none` dashboard above all — needs a host series carrying
  at least one genuine point.
- **The cost model is per-primitive, not per-shape.** 500 boxes in one primitive is one `hitTest` per
  mouse move; 500 primitives is 500. Ranks 42, 46 and 58 all put several hundred rectangles on screen,
  and the obvious one-primitive-per-`box.new` mapping fails as a *performance* problem rather than a
  correctness one — easy to ship, hard to diagnose.

---

## 6. Mechanical-inventory errors found

The `primitives` and `language` fields in `lane3_candidates.json` are regex counts. Reading all twenty
sources turned up the following, in rough order of how much they distort a ranking.

### (A) `delete` counts only the **function-call form**

The regex matches `box.delete(` / `line.delete(` / `label.delete(` / `polyline.delete(` / `table.delete(`
and **misses the method form `obj.delete()`** entirely. Confirmed by contrast: ranks 41, 46 (`delete×21`)
and 54 (`delete×228`) are exactly right because those authors use the function form throughout.

| rank | reported | actual | uncounted form |
| --- | --- | --- | --- |
| 45 | *absent* | 13 | `boxes.delete()`, `Lin.pop().delete()`, `Ang.get(0,i).delete()` |
| 51 | *absent* | 16 | `aZZ.l.pop().delete()`, `get.ln.delete()`, `targHi.pop().delete()` |
| 58 | *absent* | ~16 | `TPOdraw.shift().delete()`, `VAbox.delete()`, `lines.delete()` |
| 59 | *absent* | 7 | `zig_zags.shift().delete()`, `equipoints.shift().delete()` |
| 47 | *absent* | 3 | `allConsBox.get(i).delete()` |
| 60 | 4 | **16** | 12 further `shift().delete()` / `array.remove(...).delete()` |

Four of twenty rows report **zero deletes for scripts that delete constantly**.

### (B) `arr<draw>` misses UDT fields and misses `var` scalars — and is not comparable across rows

It counts *containers*, so drawing objects held in UDT fields or in plain `var` scalars are invisible:

- **Rank 54** — `arr<draw>` **absent**, and it has the largest live drawing population in the slice
  (~1,800 lines / ~1,950 labels). Every object lives in a function-local `var` scalar.
- **Ranks 41 and 46** — `arr<draw>×3`, missing **18 drawing-object fields** each (`FVG` = 5 `box` +
  2 `line`; `orderBlock` = 5 `box` + 6 `line`).
- **Rank 49** — `arr<draw>×6` counts three arrays, misses the **twelve** `var line`/`var label`/`var box`
  scalars (lines 579–590) that the script actually spends its bars mutating.
- **Rank 58** — misses ten scalar handles (lines 473–482). **Rank 50** — no `arr<draw>` at all despite
  ~28 objects in scalars. **Rank 48** — misses three scalar `var label` handles.
- **Rank 45** — misses `Ang = matrix.new<line>(4,13,line(na))`, a **matrix used as a drawing-object
  container** holding 52 lines. No `matrix<line>` / `matrix<label>` detection exists.

And the metric is **inconsistent between rows**, so it cannot be compared:

| rank | reported | what was actually counted |
| --- | --- | --- |
| 59 | 21 | declaration *and* function-signature type annotations |
| 51 | 19 | UDT field annotations |
| 60 | 8 | `array.new<box|line>` declarations only |
| 44 | 2 | `array.new_line()` / `array.new_label()` only — `array.new<box>(na)` and the `panel` UDT's `box[]`/`label[]` fields ignored |

### (C) `primitives` counts **call sites**, not objects

Systematic, and it is the field most likely to be mistaken for a complexity measure.

| rank | reported | live objects |
| --- | --- | --- |
| 54 | `line.new×57`, `label.new×57` | ~1,800 lines, ~1,950 labels (25 patterns × 6 timeframes × per-call-site `var`) |
| 42 | `box.new×4` | up to **416** boxes |
| 43 | `box.new×1` | **150** boxes (5 prediction sets × 30) |
| 48 | `polyline.new×4` | up to **88** polylines, ~17,000 vertices |
| 45 | `box.new×1`, `line.new×10`, `polyline.new×1` | 36 boxes, 64 lines, 6 polylines of 91 points |
| 41 / 46 | `box.new×3` / `×4` | 10–11 boxes *per zone* via the `createFVGBox` factory |
| 52 | `line.new×2` | up to 40 (one call site inside a `for a = 0 to 2` glow loop) |
| 57 | `line.new×4` | 10 (one call site inside a `for k = 1 to 7` loop) |
| 55 | `box.new×3` | up to 58 |

### (D) `table.cell×N` is also a call-site count

**Rank 50** reports `table.cell×17`, but the cells are emitted from helper functions (lines 2209–2263)
looping over up to **10 dynamic columns × ~15 rows** — roughly **130** cells. Ranks 42 (16) and 43 (33)
happen to be literal and are accurate.

### (E) Table *mutations* are captured nowhere

`table.merge_cells` (41, 43 ×6, 46, 53), `table.clear` (50, 53), `table.set_position` (42),
`table.delete` (50). None appear in `primitives`, so "has a table" reads identically whether the table
is a static 1×1 stamp (rank 60) or a dynamically-sized, position-mutating, merged-cell dashboard.

### (F) The `.all` global collections are captured nowhere

`polyline.all` (rank 44, line 445) and `line.all` / `box.all` / `label.all` (rank 58, lines 585–597).
This is a distinct object-management mechanism — *iterate every drawing the script owns* — and it
scores zero on every metric.

### (G) v6 `enum` declarations are not counted as types

**Rank 58** declares `enum calcType` (line 7) and reports `UDT×2`, counting only the two `type`s.

### (H) Create-once-and-mutate is indistinguishable from create-per-bar

No metric counts setters (`box.set_*`, `line.set_*`, `label.set_*`). **Rank 56** allocates its entire
50-object pool once on `barstate.isfirst` and thereafter only mutates — and therefore reads as the
*simplest* script in the slice (`box.new×2`, `line.new×6`). Ranks 49, 50, 53 and 60 are also
mutation-dominated. This is the single most misleading omission for anyone using the inventory to
estimate porting effort, because mutation-based scripts are the *cheapest* to port to a layer primitive
and the counts say the opposite.

### (I) `tv_stats` cannot cross-check `primitives`

It is `null` for 5 of 20 (ranks 48, 52, 58, 59, 60) and, where present, only reports
`plot` / `plotshape` / `plotchar` / `alertcondition`. It never covers the drawing-object layer, so it
offers no independent check on the field that matters.

### (J) Minor — `license`

Ranks 42, 43 and 50 read `NONE-IN-SOURCE (TV default MPL-2.0)`. That is a reasonable *inference*
(TradingView's default for a published open script is MPL-2.0) but it is an inference, not a source
fact, and should not be treated as one downstream.

---

## 7. Source-level oddities found while reading (not inventory errors)

Recorded because they affect what a faithful port has to reproduce.

- **Rank 45** — the six `alertcondition`s compare **price** (`low` / `high`) against `x0` and
  `x.get(i)`, which are **bar indices**. The Gann-box breakout alerts are comparing prices to bar
  numbers. Almost certainly a bug in the published script.
- **Rank 51** — FVG boxes are **never deleted**. Invalidated ones are hidden by setting `bgcolor` to
  100 % transparency and collapsing `right` back to `left`, so the live box count climbs monotonically
  to `max_boxes_count = 500` and Pine then silently evicts the oldest. The visible behaviour depends on
  that eviction.
- **Rank 60** — under *Show Historical S/R*, a broken zone is `array.remove`d **without** `.delete()`:
  a deliberate leak that keeps it on screen forever while making it unreachable for any further update.
  **Rank 55** does the same to pivot rails that get hit.
- **Rank 49** — `signalCardHistory` is push-only by design, with a source comment saying so; it walks up
  to the `max_labels_count = 300` ceiling.
- **Rank 56** — seven `var float` / `var int` declarations sit **inside** the `for i` loop in
  `update_drawings()` (lines 450–456). `var` persists across loop iterations *and* bars, so every
  iteration shares one variable.
- **Rank 59** — `generate_ellipse()` pushes its first vertex as `chart.point.new(na, start_x + x, …)`
  while `x` is still `na`, so the first polyline point has an `na` index.
- **Rank 44** — `array.new<box>(na)` / `array.new<label>(na)`: arrays constructed with an `na` size.
- **Rank 58** — `input.int(7, title = "TPO Overview Label Size")` is declared inside the `TPO()`
  function body, deep inside a conditional.
- **Ranks 43 and 53** — `max_labels_count` (and for 43 `max_lines_count`) are **not declared**, so those
  ceilings are the **50** default rather than 500, while both scripts routinely create more. Any port
  that keeps unbounded arrays will diverge from TradingView.
- **Ranks 41 and 46** share ~757 identical lines (the same FVG / order-block framework by the same
  author); 46 adds breaker blocks and the FVG∩BB overlap detector. They should be ported as one
  component, not two.

---

## 8. Recommended architecture for this slice

Nothing here contradicts lane5b §14; these are the slice-specific reinforcements.

1. **One layer primitive per Pine object *class*, never per object.** `ZoneLayer`, `LabelLayer`,
   `LineLayer`, `PolylineLayer`, `BandLayer`. Ranks 42, 46 and 58 each put several hundred rectangles on
   screen; the per-primitive cost model makes the naive mapping fail as a performance problem.
2. **Build the future-slot machinery first.** Eleven of twenty scripts draw past the last bar
   (rank 45 by up to 500 bars, rank 56 by ~150). A hidden `LineSeries` fed only `WhitespaceData` on the
   correct calendar grid is the prerequisite for all of them — and `StockChart.jsx`'s
   `buildFutureWhitespace(lastLwcTime, tf, minCount, targetSlot)` already exists.
3. **Guard every coordinate conversion.** `logicalToCoordinate(3.5)` returns `0` silently and
   `timeToCoordinate(t)` returns `null` for anything not exactly on the scale. Rank 51 passes a float
   offset; ranks 41, 46, 56 and 58 pass synthesized `bar_time` instants. One shared
   `anchorToX(anchor)` helper that always rounds to an integer logical index, with the sub-bar fraction
   applied as `fraction * barSpacing`, removes a whole class of silent-zero bugs.
4. **Build the label-placement pass early**, before it is needed. Rank 54 makes it unavoidable and ranks
   42, 48, 55, 56 and 58 all want it. It is the largest genuinely missing piece of functionality and it
   is invisible until the chart gets dense.
5. **Tables are DOM overlays**, created and destroyed from a pane primitive's `attached` / `detached`.
   Twelve of twenty scripts have one; several use merged cells, dynamic column counts, per-cell
   tooltips and emoji. Canvas gets none of that and the text would be unselectable and inaccessible.
   Remember pane pruning: removing a pane's last series destroys the pane and its primitives with it.
6. **Keep Pine's model / renderable split where the author already made it.** Rank 47 is the exemplar —
   models mutated per bar, drawing objects materialised in bulk only when it is time to paint — and it
   is exactly the shape an LWC layer primitive wants (`updateAllViews()` does coordinates, `draw()` is
   pure canvas).
