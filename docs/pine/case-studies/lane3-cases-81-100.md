# Lane 3 — Visual complexity case studies, ranks 81–100

**Authority:** READ_ONLY_RESEARCH. **Date:** 2026-09-08.
**Target platform:** Lightweight Charts **v5.2.0** (the version `origin/master` pins and that is installed — see `lane5a-lwc5-core.md` Part 1).
**Machine-readable companion:** `lane3-cases-81-100.json` (same 20 entries, full field set).

Every one of the 20 sources was read end to end. Snapshots were viewed where present (12 of 20);
the 8 missing ones are named below and their visuals were reconstructed from source only.
Vocabulary throughout is taken from `lane5b-lwc5-plugins.md` (series primitive / pane primitive /
custom series / the four zOrder paint slots / `hitTest` / `ISeriesPrimitiveAxisView`).

---

## 1. Headline numbers

| Difficulty | Count | Ranks |
| --- | --- | --- |
| 1 — native series/markers | 0 | — |
| 2 — one simple primitive | 2 | 90, 100 |
| 3 — primitive + real bookkeeping | 10 | 81, 82, 85, 87, 91, 95, 96, 97, 98, 99 |
| 4 — multiple coordinated primitives / custom series / a text engine | 8 | 83, 84, 86, 88, 89, 92, 93, 94 |
| 5 — needs a capability LWC v5 lacks | 0 | — |

**Infeasible: 0 of 20.** Nothing in this slice needs a capability the v5 plugin API lacks. Every
"hard" item is hard because *we* write the renderer, the hit test, the text layout and the autoscale
contribution — which is exactly the verdict lane5b reaches for all six of its hard-visual cases
("the API lets you, the library helps you with none of it"). **Difficulty 5 was considered and
rejected for every entry**; the closest calls are recorded in §4.

Not one script in this slice is expressible with native series + markers alone. The floor is a
primitive because **every** script draws at least a `box.new`, and LWC's built-in visual vocabulary
is only *series, markers, price lines*.

---

## 2. Per-script summary

| # | Script (author) | The visual, in one line | Steady-state objects | Management mechanism | LWC approach | D |
| --- | --- | --- | --- | --- | --- | --- |
| 81 | Swing Profile (BigBeluga) | Mirrored volume profile per swing leg + closed-polyline silhouette + POC line + zigzag + arrow label with tooltip | binCount boxes (~10–40) + 1 polyline + 2 lines + 1 label **per leg**, accumulating | `array<box>` pool drained every bar; `x := new(); delete(x[1])` history idiom; `barstate.islast` gate | 1 series primitive (bg fills + stroked polygon) + `createSeriesMarkers` + DOM tooltip | 3 |
| 82 | Open Liquidity Heatmap (BigBeluga) | 250 tinted horizontal bands + left volume profile + right liquidation bars + POC pill | ~750 (250 lines + ~500 boxes + 2 polylines + 2 labels) | Nuclear `for obj in line.all/box.all/label.all/polyline.all: delete()` then full rebuild; lines double as the data structure | 1 series primitive; right bars need **future whitespace slots** | 3 |
| 83 | Smart Money Concepts (LuxAlgo) | BOS/CHoCH lines with midpoint captions, OB boxes, EQH/EQL, right-projected Strong/Weak lines, recoloured candles | 10–40 pooled boxes + ~12 singletons + unbounded history in HISTORICAL mode | **Three mechanisms**: `barstate.isfirst` box pool; function-scope `var` singletons; UDT arrays capped at 100 | StructureLayer + BoxLayer primitives; `plotcandle` is **native**; axis-view pills | 4 |
| 84 | Orderblock Footprints (AlgoAlpha) | OB boxes split into proportional up/down half-bars + a per-bar footprint built from ~42 monospace glyph labels | 3 boxes/block + up to 42 labels **per in-zone bar**, never freed | 8 index-parallel arrays; half-boxes mutated; footprint labels fire-and-forget on Pine's GC | BoxLayer primitive **+ a custom series** for the footprint (heatmap-series model) | 4 |
| 85 | Volume Profile w/ Node Detection (LuxAlgo) | 100-row two-segment profile + node overlays + developing-POC polyline + 5 right-edge price labels | ~300 boxes, 4 lines, 5 labels, 1 polyline | Full delete-and-recreate of boxes each `islast`; lines/labels are `var`-in-function singletons | 1 series primitive; the shipped `volume-profile` example is a direct template | 3 |
| 86 | OI Footprint IQ (TradingIQ) | Per-bar OI cell stack, each cell carrying a 6-line text block; POC/value-area glyphs; corner table | Ring-buffer-bound: 500 boxes + 500 labels **is** the design | **None** — no `.delete()` in the file; only the data arrays are managed (90k cap) | **Custom series** + hover tooltip (text cannot be painted at density) + DOM table | 4 |
| 87 | Order Blocks W/ Realtime Fibs (QuantVue) | OB rectangle + a 7-level live fib fan, each level with a `.618 ($36,617.43)` right-edge label | 1 box + 7 lines + 7 labels per block | `line.all`/`label.all` bulk wipe then rebuild; per-fan element-wise delete on new extreme | 1 series primitive; fib captions → `ISeriesPrimitiveAxisView` for free de-overlap | 3 |
| 88 | Algo Market Structure (nephew_sam_) | HTF swing circles + HH/LL captions, ILQ/TLQ/EPA levels projected **7 bars forward**, Extreme/VTA boxes, table | ~20 singletons + unbounded VTA boxes + 1 line/label per BOS | `var` singletons + `delete(x[0])`/`delete(x[1])` history idiom + two "already used" `int[]` ledgers | LevelLayer + BoxLayer + markers + **future whitespace** + DOM table | 4 |
| 89 | Volume Delta / OI Delta (Kioseff) | A wall of outlined neon delta numbers at every touched price level, behind a `linefill` heatmap band | Hundreds–thousands; capped only by Pine's 500-label ring | Wholesale `label.all` wipe (mutating a read-only array) + `var` arrays mutated in place | Series primitive with a **real text-layout + decimation engine**; band = per-pair quads | 4 |
| 90 | Poor man's volume profile (AkhIL) | 40-row profile where each bar is a run of `#` characters inside one label | **Exactly 42**, forever | Pure singleton mutation; 40 hand-unrolled `var label`s (1,102 lines for 40 rows) | 1 small primitive; draw the bar as geometry, not as a glyph run | 2 |
| 91 | Breaker Blocks with Signals (LuxAlgo) | One live breaker block: 2 rects (one projected +8 bars), mid-line, swing lines, PD arrays, TP rails, glyph stack | **Fixed ~21 objects** | Textbook **preallocate-and-mutate**: every drawing is a field of one `var` UDT built from `na` placeholders | 1 series primitive; `n+8`/`n+20` need integer `logicalToCoordinate` | 3 |
| 92 | SMC (Advanced) (robbatt) | OB boxes snapped to their own Value Area + POC pills, FVG boxes with fill targets, BOS/CHoCH, PD zones | **Unknowable from this file** — see error E3 | Buffer-and-config; `keep_max` ring buffers; `hide()`/`extend_only` exist solely to dodge `max_bars_back` | 4 coordinated primitive layers + a per-block profile layer | 4 |
| 93 | ICT Silver Bullet (Flux Charts) | Session verticals with top-pinned captions, hour high/low, FVG box, TP/SL bands with prices, backtest table | ≤9 per setup, fully rebuilt each confirmed bar | Wholesale drain of `lineX`/`boxX`/`labelX` then rebuild from the UDT model | SetupLayer primitive + **pane** primitive for top captions + DOM table | 4 |
| 94 | Volume Sentiment Breakout Channels (AlgoAlpha) | Channel box with captioned bands, 20-row profile left, 20-row profile right, **gradient `fill()`** after a break | 3 boxes + 5 lines + 20 boxes per channel, + 20 rebuilt each bar | 8 index-parallel line arrays removed in lockstep; right profile fully re-created each bar | ChannelLayer primitive + a `Path2D` region with `createLinearGradient` | 4 |
| 95 | Supply & Demand MTF (Flux Charts) | Multi-timeframe zone rects with dashed mid-lines and a `"4 Hours & 1 Hour"` caption; R/B retest pills | ~360 boxes + ~180 lines at full tilt | **Full teardown and rebuild every confirmed bar** + O(n²) merge; pills keyed in `map<int,label>` | 1 series primitive; the in-rect caption removes Pine's second "text carrier" box | 3 |
| 96 | True Close / Sessions (Zeiierman) | Per-session range box + nested first-hour box + true-close line projected +10 bars + 6×6 tooltip dashboard | **Exactly 20** + a 25-cell table (no session history retained) | Index-0 replacement: every UDT array is permanently size 1 | SessionLayer primitive + axis-view pills + DOM dashboard | 3 |
| 97 | Volume Supply and Demand (TradingIQ) | Zone box + a ~12-row profile rendered **entirely as runs of block characters inside transparent boxes** | ~150 (10 zones × ~15) | `Drawing` UDT ring trimmed by `shift().delete()`; `clean()` age/break sweep | 1 series primitive; re-express the glyph run as `positionsBox` geometry | 3 |
| 98 | ICT Turtle Soup (Flux Charts) | Liquidity band + Buy/Sell pills + TP/SL bracket rails with pills + backtest table | Up to 126 setups × ~10 objects (≈500 lines, ≈500 labels) | Same drain-and-rebuild as #93; `math.min(125, …)` is the only culling | SetupLayer primitive (bounded rails, **not** `createPriceLine`) + DOM table | 3 |
| 99 | S&D: CVD Flow (ChartPrime) | Zone rects with a **filled CVD wave polyline nested inside each one** | ≤20 zones × (1 box + 1 polyline up to 2,900 pts) | 5 index-parallel arrays; polyline deleted and rebuilt **every bar per zone**; `polyline.new(na)` as a placeholder | 1 primitive; `Path2D` closed region — the `bands-indicator` shape | 3 |
| 100 | Breaker Blocks Signals (AlgoAlpha) | Grey impulse rects → coloured breaker rects, each with a dashed mid-line; formation/rejection glyphs | 4 families × (1 box + 1 line) per zone | 12 index-parallel arrays; the **box is the source of truth**, the mid-line derived from it | 1 series primitive + native arrow markers | 2 |

---

## 3. Object-management taxonomy observed

Across the slice, only **six** distinct mechanisms appear. This is the useful finding: a Pine
renderer needs to support these six, not twenty ad-hoc styles.

1. **Preallocate-and-mutate** (91 in its pure form; 83's box pool; 85's `var`-in-function singletons;
   90's 40 unrolled labels; 96's size-1 arrays). Objects are created once from `na` placeholders and
   thereafter only `set_*`. **Maps perfectly onto a primitive's model array** — no allocation churn.
2. **Delete-and-recreate wholesale** (82, 93, 95, 98; 85's boxes; 94's right profile; 99's polylines).
   The drawings are a pure projection of a UDT model. **This is the LWC-friendliest pattern**: recompute in
   `updateAllViews()`, return a *new* views array (the library caches by array reference).
3. **Index-parallel array families** (84, 88, 94, 99, 100 — up to twelve arrays advanced in lockstep).
   Fragile in Pine (84 and 100 both carry defensive `if array.size(x) > i` guards); in LWC it collapses
   to one array of model structs.
4. **Ring buffer with an explicit cap** (91's 50-slot ZigZag, 92's `keep_max`, 97's `Drawing[]` ring,
   99's `trimDemand`). Straightforward to port.
5. **Bulk `.all` sweeps** (82, 87, 89 — including 89 mutating the documented read-only `label.all`).
   No LWC analogue is needed; it is just "clear the model".
6. **No management at all — lean on Pine's automatic GC** (84's footprint labels, 86 entirely, 89's
   per-bar labels). **LWC has no automatic eviction of anything**, so Pine's `max_*_count` ring buffer
   has to be reimplemented as an explicit cap in our model. This is the one mechanism that is *invisible*
   in the source and will be missed by anyone porting mechanically.

A seventh, rarer idiom worth naming: **history-referencing a drawing-object series** —
`label.delete(dataLabel[1])`, `delete_box(tf1_topExtremeBox[1])`, `label.delete(tf1_pivotHighLabel[0])`
(ranks 81, 88). It means "kill the instance from the previous bar" and has no direct analogue; it must
be recognised and translated to explicit model replacement.

---

## 4. The three hardest, and why

**1 — rank 89, Volume Delta | OI Delta [Kioseff Trading].** The only script in the slice that needs a
genuine **text-layout engine**. It places hundreds of simultaneous numeric labels at arbitrary
(bar, price) pairs, styled `label.style_text_outline`, and expects them to remain readable. LWC has
*exactly one* overlap resolver in the entire codebase (`recalculateOverlapping()` in
`price-axis-widget.ts`) and it applies to price-axis labels only; `createSeriesMarkers` supports
`text` but performs no collision detection whatsoever. So we must write: cached `measureText`
(vendor `TextWidthCache` for its LRU, digit-normalised keys and `yMidCorrection`), per-slot placement,
visible-range culling, density-based decimation, and a fake outline (`strokeText` then `fillText`).
On top of that, the heatmap band is a `linefill` between adjacent lines and **LWC has no
fill-between-two-series API at any level** — `AreaSeries` fills to a fixed base, `BaselineSeries`
against a single scalar. Both halves are unbuilt, not impossible.

**2 — rank 92, Smart Money Concepts (Advanced) [robbatt].** Hard for a different reason: the
*authoritative drawing semantics are not in the corpus*. Every persistent object goes through
`robbatt/lib_plot_objects/56` and `robbatt/lib_profile/44` (a `PF.create_profile(..., resolution = 20)`
per order block, then `Profile.draw()`), so the true object count and the exact geometry can only be
guessed from this file. It also needs four coordinated primitive layers plus a per-block profile,
axis-view pills, and future whitespace for the right-projected swing lines. The `hide()` /
`extend_only` machinery — which exists purely to dodge Pine's 244-bar `max_bars_back` buffer — is the
one thing that gets *easier*: LWC has no such buffer.

**3 — rank 86, Open Interest Footprint IQ [TradingIQ].** Three coordinated pieces. The cell stack is a
textbook **custom series** (the official `heatmap-series` example: `visibleRange` culling,
`fullBarWidth` + `positionsBox`, a `cellShader`, the `barSpacing > cellBorderWidth*3` border-drop
heuristic) — and it *must* be a custom series, because primitives get no viewport culling at all. But
each cell carries a **six-line** text block, which cannot be painted at footprint density (thousands
of `fillText` per frame, with no wrapping, no multi-line and no measurement help from the library), so
the text has to move into a hover tooltip keyed off `CustomSeriesHitTestResult.objectId`. Plus a
corner table, which is a DOM overlay. Runner-up: **rank 84**, for the same custom-series-plus-text
reason, and **rank 94**, whose gradient `fill()` between two plots has no native equivalent at all.

---

## 5. LWC v5 gaps seen 3+ times across the slice

| Gap (lane5a §2.11 / lane5b §9, §11) | Hits | Notes |
| --- | --- | --- |
| **No drawing-object layer** — `box`/`line`/`label`/`polyline`/`table` simply do not exist; LWC has series, markers, price lines | **20 / 20** | The universal floor. This is why difficulty 1 is empty. |
| **No text layout** — no measurement helper, no multi-line, no wrapping, no pill, no font control, and **no collision avoidance anywhere except price-axis labels** | **19** | Worst at 89, 86, 84, 97, 90. Vendor `TextWidthCache`, `make-font.ts`, `canvas-helpers.ts`. |
| **Cost model is per-primitive, not per-shape** — `hitTest` runs per primitive per mousemove; `updateAllViews`/`paneViews`/`renderer` per primitive per paint | **18** | Forces "one layer primitive per Pine object *class*", never one per object. Undocumented; the single most important architecture decision. |
| **Drawing past the last bar** — `timeToCoordinate` returns `null` off-data; `logicalToCoordinate(3.5)` silently returns **0** | **13** | 82, 83, 86, 87, 88, 89, 91, 92, 93, 94, 96, 97, 98. Fix: integer logical indices, or materialised `WhitespaceData` slots (the proven `buildFutureWhitespace` pattern in `StockChart.jsx`). |
| **Marker vocabulary is 4 shapes** (`circle`/`square`/`arrowUp`/`arrowDown`), plain text only, no pill, no arbitrary character | **11** | `shape.xcross` (88, 93, 98), `shape.labelup`+text (100), emoji (87), `●`/`❌` (91), `△`/`▽` (99), `plotchar` (93, 94, 100). |
| **No viewport culling for primitives** (custom series get `visibleRange`; primitives get nothing) | **7** | 81, 82, 85, 89, 92, 97, 99. Also the deciding argument for making 84 and 86 custom series. |
| **No MTF / trading-session / timezone / holiday model of any kind** | **6** | 83, 88, 92, 95 (MTF); 93, 96 (sessions). Entirely ours, and future whitespace must be generated on the correct calendar grid. |
| **No table primitive** (and no `merge_cells`) | **5** | 86, 88, 93, 96, 98. Recommendation stands: DOM overlay, as the official `tooltip` and `accessibility` plugins do. |
| **No fill between two series** — `linefill`, `fill(plot1, plot2, …)`, filled `polyline` | **3** | 89 (`linefill`), 94 (**gradient** two-plot fill), 99 (`polyline(closed=true, fill_color)`). All become `Path2D` regions in `drawBackground` at `'normal'` — the `bands-indicator` shape. |
| **No tooltip API** for any drawn object | **3** | 81 (label tooltip), 86 (label tooltip), 96 (label + every table cell). Needs `hitTest` → `hoveredInfo.objectId` → DOM overlay. |
| **No automatic drawing-object eviction** — Pine's `max_*_count` ring buffer is load-bearing *by design* | **3** | 84, 86, 89. Must be reimplemented as an explicit model cap; invisible in the source. |

Two structural constraints from lane5a worth restating because they bite here: **overlay price scales
are always auto-scaled and always hidden** (so ≤2 visible scales per pane), and **pane primitives
cannot participate in autoscale** (`IPanePrimitiveBase` has no `autoscaleInfo`) — which is why rank 93's
top-pinned session captions are the *only* thing in this slice that may safely live on a pane primitive.

---

## 6. Mechanical-inventory errors and discrepancies found

I re-derived every `primitives` count independently (comment-stripped regex over each source) and
compared it to `lane3_candidates.json`. **All 20 `primitives` strings and all 20 `tv_stats` blocks
match my counts exactly.** The problems are of a different kind:

**E1 — rank 86: `table.cell` missed entirely (method-call form).** The source calls
`warning.cell(0, 0, …)` twice (lines 537, 545). The inventory records `table.new×2` but **no
`table.cell` at all**; the scanner matches `table.cell(` and not the `.cell(` method form. Contrast
ranks 88/93/96/98, where the function form *is* counted. Any per-cell cost model built on this field
will read rank 86 as having a zero-cell table.

**E2 — ranks 93 and 98: `table.merge_cells` is absent from the inventory vocabulary.** Both call it
once (93 line 512, 98 line 405). Cell spanning is a distinct visual capability with **no LWC analogue**
and it is invisible in the measured data.

**E3 — rank 92: the inventory undercounts by an unknown but large factor.** It records the 19 direct
`label/line/box.new` calls in the file. Every *persistent* drawing actually goes through
`robbatt/lib_plot_objects/56` (`D.Box`, `D.create_line`, `D.create_label`, `D.create_point`) and
`robbatt/lib_profile/44` (`PF.create_profile(..., resolution = 20)` → `Profile.draw()`), whose source
is not in the corpus. A single order block with a profile is ~20 rows *by itself*. **The true object
count for rank 92 is not knowable from the acquired data.** This is a corpus-coverage gap, not a
scanner bug: imported-library sources were not fetched.

**E4 — `primitives` counts CALL SITES, not runtime instances, and the ratio varies by ~2 orders of
magnitude.** This is the field's biggest interpretive trap. Examples from this slice:
`rank 90 "label.new×40"` = 40 real labels (1:1); `rank 95 "box.new×1"` = one `createSDBox` call site
that yields **2 boxes per zone × up to ~180 zones ≈ 360**; `rank 85 "box.new×10"` ≈ **300** runtime
boxes; `rank 84 "label.new×3"` ≈ **42 labels per in-zone bar**; `rank 86 "box.new×2"` ≈ **500** (the
ceiling). Any ranking or cost model that treats `primitives` as an object count is wrong by design.

**E5 — two sources declare a `max_boxes_count` above Pine's documented maximum.**
`rank 99: max_boxes_count = 5000` and `rank 96: max_boxes_count = 1000`. The Pine reference is explicit
(`visuals_lines-and-boxes.txt:310–315`): *"A single script instance can display up to 500 lines, 500
boxes, and 100 polylines … If unspecified, the default is ~50."* The **effective ceiling is 500 in both
cases**; the declared number is misleading and, if read literally, would size a renderer's pool 10× too
large for rank 99.

**E6 — declared-but-unused ceilings (dead declarations).** rank 84 declares `max_lines_count=500` with
**no `line.new` in the file**; rank 100 declares `max_labels_count=500` with **no `label.new`**;
rank 97 declares `max_labels_count=500` *and* `max_polylines_count=100`, using neither; rank 86
declares `max_polylines_count=100`, unused.

**E7 — missing ceilings that actually bind (the more dangerous direction).** rank 87 draws boxes with
**no `max_boxes_count`**, so order blocks are capped at Pine's ~50 default; rank 88 likewise for its
unbounded VTA `box[]` arrays; rank 94 maintains **eight parallel `line[]` arrays with no
`max_lines_count`** — its real ceiling is ~50 lines, i.e. ~6 channels; rank 81 creates a line and a
polyline per swing leg against the ~50 default; rank 85 leaves lines/labels/polylines at the default
and survives only because they are singletons.

**E8 — rank 89 exceeds its own declared ceiling in "classic" mode.** Lines 1083–1085 run
`for i = 0 to bar_index - miN` creating **two `line.new` per bar** to reconstruct the candles, against
`max_lines_count = 500`. Past ~250 visible bars Pine silently evicts the oldest, so the reconstructed
candles are truncated from the left. A real source defect, visible only by reading.

**E9 — rank 86 has dead visual code.** The `gradientDrawings` UDT declares `array<line>`,
`array<linefill>` and a `label`, and `heatmapData` accumulates `gradientLevelsDelta`/`Price` every
bar — none of it is ever instantiated or drawn. The inventory correctly shows no `linefill`; the trap
is for a reader who compares the type declarations against it and assumes something was missed.

**E10 — rank 95 has dead UDT fields.** `sdZone` declares `sdBoxLineTop` and `sdBoxLineBottom`, both
`line.delete()`d in `safeDeleteSDZone()` but **never created**; only `sdBoxLineMiddle` exists.

**E11 — 8 of 20 `snapshot_file` paths do not exist on disk**, although `snapshot_url` is populated for
all 20: ranks **86, 88, 90, 93, 96, 97, 99, 100** (`lLG6gDb4`, `o0pJo9hm`, `IWdpl712`, `1kwkYj40`,
`YkinBU20`, `wXnHSPYP`, `paLrV2ud`, `dxBmw7bF`). Their `what_it_draws` entries are reconstructed from
source only and are flagged as such in the JSON.

**E12 — rank 93 carries dead declarations**: `const int showLastXLiqs = 10` and the `fillBackgrounds`
input are never referenced.

**E13 — rank 89's version directive is malformed.** Line 5 of the acquired source reads
`// @version = 6` (with spaces), which is **not** a valid Pine version directive — the canonical
`//@version=6` line is absent from the captured text. The metadata records `pine_version: 6`, which is
presumably from TradingView's API rather than the source text. Low-confidence metadata for this one
entry; worth a re-fetch if version matters downstream.

---

## 7. Recommended build order implied by this slice

1. **`BoxLayer` + `LineLayer` as one series primitive each, with a model array, an x-bucket `hitTest`
   index and cached `autoscaleInfo`.** This alone covers ranks 87, 90, 91, 95, 97, 99, 100 and most of
   81, 82, 85 — 10+ of 20.
2. **Future-axis extension** (hidden `LineSeries` + `WhitespaceData` on a timeframe-correct grid).
   13 of 20 need it; without it, right-projected levels silently collapse to the pane's left edge.
3. **`LabelLayer` with real measurement, caching and a greedy placement pass.** 19 of 20 draw text;
   this is the item lane5b explicitly flags as the one most likely to be under-estimated.
4. **Custom-series scaffold** (heatmap-style, per-bar cell stack). Unlocks 84 and 86, the two
   footprint scripts, and is the only route to viewport culling.
5. **`Path2D` region fill** (`drawBackground` at `'normal'`, gradient-capable). Unlocks 89, 94, 99.
6. **DOM overlay harness** driven from a pane primitive's `attached()`/`detached()`, for tables and
   tooltips. Needed by 86, 88, 93, 96, 98 (tables) and 81, 86, 96 (tooltips).
