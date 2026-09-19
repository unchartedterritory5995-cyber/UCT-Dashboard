# LWC v5 CAPABILITY MAP
### How every Pine presentation primitive gets rendered on Lightweight Charts v5.2.0, and what it costs

**Date:** 2026-09-08 · **Authority:** READ_ONLY_RESEARCH (no repo file written, no git mutation).
**This is the renderer's architectural reference.** Ordered by *surveyed demand*, not by taxonomy.

**Provenance rule for this document.** Every LWC API name, signature, enum member and behaviour
below is traceable to one of two audits that quoted the shipped typings and the library source:

| Tag | Source |
|---|---|
| `[5A]` | `scratchpad/research/lane5a-lwc5-core.md` — core surface, from `app/node_modules/lightweight-charts/dist/typings.d.ts` (5.2.0, 5,041 lines) + `/docs` |
| `[5B]` | `scratchpad/research/lane5b-lwc5-plugins.md` — plugin surface, from `typings-5.2.1.d.ts` + the `master` source tarball + the local 5.2.0 install |
| `[4A]`…`[4E]` | `lane4a-plot-family.md`, `lane4b-fills-colors.md`, `lane4d-boxes-polylines-limits.md`, `lane4e-tables-declaration.md` — the Pine v6 side (`PINE-PRESENTATION-SPEC.md` did not exist at write time) |
| `[REF6]` | `scratchpad/research/pine_v6_reference.json` — the v6 reference manual data, queried directly for `label.new` / `line.new` / `linefill.new` / the `label.style_*` and `yloc.*` constant sets, which no lane4 file covers |
| `[DEM]` | `scratchpad/acq/table_presentation.md` + `agg_presentation.json` — n=1,443 surveyed open-source community scripts |
| `[REPO]` | `git show origin/master:<path>` — our own shipped chart engine |

**No LWC API name or signature in this document is invented.** Anything not traceable is marked
**UNVERIFIED** with the experiment that would settle it.

---

## 1. VERSION STATEMENT

### 1.1 What we run

| Location | Declares |
|---|---|
| **`origin/master:app/package.json`** | **`"lightweight-charts": "5.2.0"`** — exact pin, no caret |
| **`origin/master:app/package-lock.json`** (line 5188) | **`5.2.0`** (`sha512-ey3Vas8UhV06ni+…`) |
| Physically installed `app/node_modules` | **5.2.0** (`dist/typings.d.ts`; `"5.2.0"` in `lightweight-charts.production.mjs`) |
| Working copy `app/package.json` line 30 | `^5.1.0` — **STALE, ignore** |
| Working copy `app/package-lock.json` line 4079 | `5.1.0` — **STALE, ignore** |

**Ruling: we run 5.2.0** (published 2026-04-24). `origin/master` is the deploy authority — Railway
builds from git push — and it pins the version exactly. The local working copy is the known
STALE/PARKED tree; nothing here should be planned against 5.1.0. `[5A]`

Anyone who *does* plan against 5.1.0 loses, specifically: `MouseEventParams.hoveredInfo`
(the whole hit-test read-back surface), `hoveredSeriesOnTop`, `defaultVisiblePriceScaleId`,
`tickMarkDensity`, and `CustomSeriesHitTestResult`. `[5A]`

### 1.2 What 5.2.1 would add

5.2.1 was published **2026-08-12** and we have not taken it. `[5A]`

- Its **changelog content is UNVERIFIED** — `[5A]`'s release-notes fetch did not enumerate 5.2.1
  separately.
- But its **typings are effectively identical for everything this document depends on.** `[5B]` did
  the cross-check the other way round: it took every signature in this map from
  `typings-5.2.1.d.ts` (downloaded from jsdelivr), cross-checked against the locally installed
  5.2.0, and reported *"Everything below holds for both unless noted"* — including confirming
  `DrawingUtils` is already present at 5.2.0 (3 occurrences in the local install).

So the plugin/primitive/custom-series surface this renderer is built on is the same at 5.2.0 and
5.2.1. **A 5.2.1 bump would be hygiene, not a capability unlock.**

### 1.3 Verdict: no upgrade, no fork

**No finding in this document requires an upgrade from 5.2.0, and no finding requires a fork of
Lightweight Charts.** I confirm `[5B]`'s verdict rather than contest it, and I can state exactly
what the conclusion rests on:

| Pine need | The v5.2.0 mechanism that carries it | Traceable to |
|---|---|---|
| Arbitrary 2-D geometry at arbitrary (bar, price) anchors | `ISeriesPrimitive` — a **type alias** whose every member is optional; `IPrimitivePaneRenderer.draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils)` gives raw Canvas2D | `[5B]` §2, §4 |
| Anything must stay in view | `ISeriesPrimitiveBase.autoscaleInfo?(start: Logical, end: Logical): AutoscaleInfo \| null` (merged by union onto the host series' range) | `[5B]` §8 |
| Per-bar geometry at dataset scale with free viewport culling | `addCustomSeries(ICustomSeriesPaneView)` → `PaneRendererCustomData.visibleRange` | `[5B]` §7 |
| Hover + click on a drawing | `hitTest?(x, y): PrimitiveHoveredItem \| null` → `MouseEventParams.hoveredInfo.objectId` (5.2.0) | `[5B]` §6 |
| Axis labels with de-overlap done for you | `ISeriesPrimitiveAxisView` | `[5B]` §2 |
| Anchoring past the last bar | `WhitespaceData` future slots + integer `logicalToCoordinate` | `[5A]` §2.8 |
| Fixed pane-anchored chrome (tables) | `IPaneApi.attachPrimitive(IPanePrimitive)` at `'top'`, or a DOM overlay | `[5B]` §3, §11(c) |

The only two things a fork *would* buy are LWC price-scale ceilings, and Pine does not need either
(see §8): a **visible, pinned (non-autoscaled) overlay price scale**, and **more than two visible
price scales in one pane**. Pine's own model routes an independently-scaled script to its own pane
(`overlay = false`), which is exactly what LWC panes give us natively.

**And the verdict is not theoretical for us.** `[REPO]` shows the plugin API is *already in
production* on this exact version: **6 hand-written primitive modules across 10 `attachPrimitive`
call sites** — 2 pane primitives (`watermarkPrimitive`, `sessionShadingPrimitive`, attached 3×) and
4 series primitives (`swingLabelsPrimitive`, `levelZonesPrimitive`, `prevDayLevelsPrimitive`,
`earningsBadgePrimitive`, attached 7×), exercising both `'top'` and `'bottom'` — plus **one
`ICustomSeriesPaneView` custom series** (`ThinVolumeSeries`). The extension points this map depends
on are not a paper capability; they are shipping. See §7.

---

## 2. THE MAPPING TABLE

Ordered by share of the 1,443 surveyed scripts. `[DEM]` Setters/getters/deleters are folded into
their constructor's row (they mutate a model, not a renderer object — see §2.1 note **M**).

Mechanism vocabulary: **NATIVE** = a built-in series / price line / marker. **SPRIM** = series
primitive (`ISeriesApi.attachPrimitive`). **PPRIM** = pane primitive (`IPaneApi.attachPrimitive`).
**CUSTOM** = custom series (`addCustomSeries`). **DOM** = HTML overlay. **MARKERS** =
`createSeriesMarkers`.

| # | Pine primitive | % scripts (sites) | LWC v5 mechanism | z-order slot | Coordinate strategy | Autoscale? | Known caveats |
|---|---|---|---|---|---|---|---|
| 1 | **`plot`** | **62.2%** (4,898) | **NATIVE** — `LineSeries` · `AreaSeries` · `BaselineSeries` · `HistogramSeries` (4 of the 7 types). 2 of 11 styles need SPRIM/CUSTOM | series' own pixels (Pine bucket 3); order plots among themselves with `setSeriesOrder` | time key per point; `offset > 0` ⇒ future whitespace slots first | **yes, natively** (its own data). `display.none` ⇒ `{visible:false, autoscaleInfoProvider: ()=>null}` | `style_cross` + `style_stepline_diamond` have no native glyph; `style_histogram`'s pixel bar width is inexpressible (`HistogramStyleOptions` = `color, base` only) |
| 2 | **`label.new`** (+`delete` 19.1%, `set_*` ≤4.7%) | **41.5%** (2,852) | **SPRIM** — one `LabelLayer` for all labels | `'normal'` + `draw()`, attached **4th** (Pine bucket 8) | x: integer logical index (`xloc.bar_index`) or ms→s→`timeToIndex(t,true)`→int (`xloc.bar_time`). y: `priceToCoordinate` | **yes, must** — return min/max of visible label prices + `margins` for pill height | 21 `label.style_*` vs 4 marker shapes ⇒ markers are unusable. De-overlap is 100% ours. `tooltip` (314 sites) needs a DOM node driven by `hitTest` |
| 3 | **`line.new`** (+`delete` 20.4%, `set_x2` 7.9%, …) | **41.2%** (3,405) | **SPRIM** — one `LineLayer` | `'normal'` + `draw()`, attached **2nd** (bucket 6) | two integer logical indices + two `priceToCoordinate`; `extend.*` ⇒ intersect the slope with the pane rect | usually `null`; contribute when a line's y is outside the series range | `createPriceLine` cannot express it (constant-price, full-width only). Pine `width` is unbounded `series int` — a primitive stroke has no cap, series/price-line `LineWidth` is `1\|2\|3\|4` |
| 4 | **`fill`** | **31.3%** (1,225) | **SPRIM** — one `FillLayer`; the official `bands-indicator` shape | `'normal'` + **`drawBackground()`** (bucket 2 — *below* the plots) | both boundary series' `priceToCoordinate` per bar, one `Path2D` region | usually `null` (both boundaries are already series); contribute for the hline↔hline overload | **No fill-between-two-series API exists.** Per-bar varying `color` ⇒ one closed sub-path per constant-colour run. The gradient overload ⇒ `createLinearGradient` between the two price coordinates |
| 5 | **`plotshape`** | **28.1%** (1,739) | **MARKERS** for the 4-shape / bar-position subset; **SPRIM** (`ShapeLayer`) otherwise | markers: `SeriesMarkersOptions.zOrder` `'normal'\|'aboveSeries'\|'top'`. SPRIM: `'normal'`+`draw()` | markers dock to a `time`; `location.absolute` ⇒ `atPriceMiddle` + `price`. `location.top/bottom` are pane-relative ⇒ SPRIM only | markers: `SeriesMarkersOptions.autoScale` (default `true`). SPRIM: `autoscaleInfo` | 12 Pine shapes vs **4** marker shapes (`circle\|square\|arrowUp\|arrowDown`); 8 have no native form. Marker `text` is one line, no font/align/pill, **no de-overlap** |
| 6 | **`box.new`** (+`delete` 11.8%, `set_right` 5.9%, …) | **25.1%** (1,274) | **SPRIM** — **ONE** `BoxLayer` owning all boxes | `'normal'` + `draw()` (fill *and* border), attached **3rd** (bucket 7) | `positionsBox(x1,x2,hRatio)` / `positionsBox(yTop,yBot,vRatio)`; x-domain `[bar_index-10000, bar_index+500]` for `xloc.bar_index` | **yes** — min/max of *visible* boxes from a cached range structure, `null` off-range | **500 boxes as 500 primitives is the trap** (500 `hitTest` per mousemove). `positionsBox` returns `length = \|Δ\|+1` — subtract back for gaps. Fill goes in `draw()`, **not** `drawBackground()`, or boxes sink below the plots |
| 7 | **`table.new` / `table.cell`** (+`merge_cells` 3.0%) | **17.6% / 13.9%** (307 / 2,285) | **DOM** overlay, created/destroyed from a **PPRIM**'s `attached`/`detached` | above every canvas (bucket 9, must be topmost). Canvas fallback: PPRIM at `'top'` | **none** — pane coordinates only. 9 anchors, expand away from the anchor; `width`/`height` are % of the pane | **no** — and `IPanePrimitiveBase` has **no `autoscaleInfo`** anyway | A PPRIM at `'normal'` paints **beneath** series primitives — that breaks Pine's "a plot can never sit above a table". Canvas at `'top'` redraws on **every mousemove**. Canvas text is unselectable + invisible to a11y; 2,285 cell sites is a lot of text |
| 8 | **`barcolor`** | **16.3%** (315) | **NATIVE** — per-point `CandlestickData.color?/borderColor?/wickColor?`, `BarData.color?` | the bars themselves (not one of the 9 buckets) | none — it is a property of the existing bar data | n/a | Requires **owning the main series' data array**. Pine `barcolor` colours the main pane *regardless of the script's pane* — the one documented cross-pane exception. `na` = leave the bar alone. `setData` is a full replace |
| 9 | **`bgcolor`** | **10.0%** (277) | **SPRIM** — one `BgLayer` (official `session-highlighting` shape) | `'bottom'` + `drawBackground()` (bucket 1, lowest) | `fullBarWidth(bar.x, barSpacing/2, hRatio)` per bar; merge runs of equal colour into one rect | **no** — return `null` | Cannot be a CUSTOM series: a custom series paints in the series pass at `'normal'`, so it could never sit below the grid. `offset` shifts the colour series by N bars |
| 10 | **`hline`** | **10.0%** (388) | **NATIVE** — `series.createPriceLine(CreatePriceLineOptions)` | `priceLineView`, which `Series.paneViews()` returns **after** `seriesPaneView` ⇒ naturally above the plots (bucket 4) | constant `price`; always full pane width | **UNVERIFIED** whether a price line widens the range — if it must stay in view, add its price via the host series' `autoscaleInfoProvider` | ⛔ **Omitting `lineStyle` takes LWC's price-line default, which is `Dashed`, not solid** — our own `binder.js` learned this at a cost of 379 px on RSI's 50 line. Always name the style. Pine `linewidth` is unbounded; `LineWidth` is `1\|2\|3\|4`. Needs a host series in the pane. Set `axisLabelVisible: false` (Pine draws no axis label) |
| 11 | **`plotcandle`** | **7.8%** (144) | **NATIVE** — `CandlestickSeries`, per-point `color?/borderColor?/wickColor?` | series pixels (bucket 3) | one OHLC point per time | **yes, natively** | Pine drops the whole bar if **any** of the 4 OHLC values is `na` ⇒ emit `WhitespaceData` at that time. Pine **re-derives** high/low as max/min of the four ⇒ do that in the adapter |
| 12 | **`plotchar`** | **7.1%** (422) | **SPRIM** — the same `ShapeLayer` | `'normal'` + `draw()` | as `plotshape` | via `autoscaleInfo` for `location.absolute` | **Markers cannot express this at all** — an arbitrary Unicode character has no marker shape. Count **codepoints, not `.length`** (U+1F807 is 2 UTF-16 units and is a documented working value); `char = ""` is legal |
| 13 | **`linefill.new`** | **6.2%** (204) | **SPRIM** — one `LinefillLayer`, coupled to `LineLayer`'s models | `'normal'` + **`draw()`**, attached **1st** (bucket 5 — above plots, below lines) | the quad between two line segments, including their extensions | `null` (the lines already contribute) | ⚠️ **Not `drawBackground()`** — Pine bucket 5 is *above* the plots, so a linefill in the background sub-pass would render below them. Deleting or moving either line deletes/moves the fill; one linefill per line pair (a second replaces the first) |
| 14 | **`chart.point.*`** (`from_index` 4.1%, `new` 1.1%, `from_time` 0.5%, `now` 0.3%) | **4.1%** (397+84+93+10) | *no render* — the coordinate model | n/a | **This is where the whole coordinate rule lives.** `from_index` → integer logical index. `from_time` → **ms** → ÷1000 → `timeToIndex(t, true)` → int. `now` → last bar index | n/a | Fields are `{time (ms), index, price}`; `xloc` decides which of `time`/`index` is authoritative. All of §5's hazards land here |
| 15 | **`polyline.new`** | **3.8%** (153) | **SPRIM** — one `PolylineLayer`, `Path2D` + béziers | `'normal'`: `fill_color` in `draw()` before the stroke (bucket 5-ish, same slot as linefill) | up to **10,000 points** per polyline; non-monotonic x is legal and documented ⇒ treat as an ordered 2-D path, never a function of x | min/max of visible vertices, cached | Worst case is 100 polylines × 10,000 points = **1M vertices** — cull to the visible logical range and decimate yourself (primitives get **no** culling). `curved=true` is a piecewise interpolant that overshoots; **TradingView never names the family** ⇒ exact parity unattainable. Do **not** round intermediate curve points (that fights `positionsLine`) |
| 16 | **`plotarrow`** | **1.2%** (34) | **SPRIM** — the same `ShapeLayer` | `'normal'` + `draw()` | pixel-length arrows: `\|value\|` normalised into `[minheight=5, maxheight=100]` **pixels** | via `autoscaleInfo` if the arrow base is price-anchored | Pine's normalisation **denominator is undocumented** (dataset? visible range? window? linear?) and the **vertical anchor is undocumented** — `[4A]` calls this "the single largest renderer-facing gap in the plot family". Marker `size?: number` is a glyph scalar, not a pixel length |
| 17 | **`plotbar`** | **0.1%** (2) | **NATIVE** — `BarSeries`, per-point `color?` | series pixels (bucket 3) | one OHLC point per time | **yes, natively** | `BarStyleOptions` has **4 fields only** (`upColor, downColor, openVisible, thinBars`) |

**Mechanism census (17 visual primitives):**

| Mechanism | Count | Which |
|---|---|---|
| **NATIVE** (built-in series / price line) | **5** | `plot`, `barcolor`, `hline`, `plotcandle`, `plotbar` |
| **NATIVE markers** (partial coverage only) | **1** | `plotshape` — the 4-shape × bar-position subset |
| **SPRIM** (series primitive layer) | **10** | `label.new`, `line.new`, `fill`, `plotshape` (general), `box.new`, `bgcolor`, `plotchar`, `linefill.new`, `polyline.new`, `plotarrow` |
| **DOM** overlay | **1** | `table.new` / `table.cell` |
| **CUSTOM series** — *required* | **0** | — |
| **CUSTOM series** — *recommended for scale* | **3** | `plot.style_histogram` (exact pixel bar width), dense per-bar `plotshape`/`plotchar`, any heatmap-shaped cell grid |
| coordinate model, no render | **1** | `chart.point.*` |

The headline: **nothing needs a custom series to be correct; three things want one to be fast.**
Seven distinct primitive *layers* (`Bg`, `Fill`, `Linefill`, `Line`, `Box`, `Label`, `Shape`,
`Polyline` — eight if `Polyline` stays separate from `Line`) cover the entire Pine drawing surface.

**Four of those layers already exist in production as narrow special cases** `[REPO]`, which is where
to start rather than from a blank file (full detail in §7):

| Layer | Existing implementation | zOrder it already uses |
|---|---|---|
| `BgLayer` (row 9, `bgcolor`) | `chart/sessionShadingPrimitive.js` — a pane primitive shading session bands | `'bottom'` ✓ matches §3.2 |
| `BoxLayer` (row 6, `box.new`) | `chart/levelZonesPrimitive.js` — a series primitive drawing price zones | `'bottom'` — **change to `'normal'` + `draw()`** for Pine bucket 7 |
| `LabelLayer` (row 2, `label.new`) | `chart/swingLabelsPrimitive.js` (+ the full placer in `ChartCalloutOverlay.jsx`) | `'top'` — **change to `'normal'`** for Pine bucket 8 and to avoid the per-mousemove redraw |
| `ShapeLayer` (row 5/12/16) | `chart/earningsBadgePrimitive.js` — glyph + pill + manual hit rects, instantiated 4× | `'top'` — same change |
| custom-series template (§6.3) | `chart/thinVolumeSeries.js` — a working `ICustomSeriesPaneView` | n/a |

### 2.1 Row notes — the implementable detail

**Row 1 — `plot`, all 11 styles.** `[4A]` §9.1 enumerates 11 `plot.style_*` members; `[5A]` §2.2
gives the series options. The map:

| Pine style | LWC | Exactness |
|---|---|---|
| `style_line` | `LineSeries`, `lineType: Simple (0)` | exact |
| `style_linebr` | `LineSeries` + a break at every `na` | see the **break/bridge** note below |
| `style_stepline` | `LineSeries`, **`lineType: LineType.WithSteps (1)`** | exact — and `pool.js` already sets it |
| `style_steplinebr` | `WithSteps` + break | as `linebr` |
| `style_stepline_diamond` | `WithSteps` + diamonds at change points ⇒ **SPRIM overlay** | no native diamond point marker |
| `style_area` | `AreaSeries` when `histbase` ≤ data min; otherwise **`BaselineSeries` with `baseValue: {type:'price', price: histbase}`** | `AreaSeries` fills to the scale bottom, not to a value; `BaselineSeries` fills to a scalar — which *is* `histbase` |
| `style_areabr` | as above + break | |
| `style_columns` | **`HistogramSeries` with `base: histbase`** | exact. Pine's `linewidth` has *no effect* on columns, and `HistogramStyleOptions` has no width field — the two agree |
| `style_histogram` | `HistogramSeries` + `base` | **inexact**: Pine `linewidth` = bar width in px; LWC has no width option ⇒ CUSTOM series for exact width |
| `style_circles` | `LineSeries` `{lineVisible: false, pointMarkersVisible: true, pointMarkersRadius}`; `join=true` ⇒ `{lineVisible:true, lineWidth:1}` | close; Pine's `linewidth` here is a *relative* size, not pixels |
| `style_cross` | **SPRIM** | no cross glyph anywhere in LWC |

- **break vs bridge — the one thing to measure first.** Pine `style_line` *bridges* `na`
  (joins the last non-`na` to the next non-`na`); `style_linebr` *breaks*. In LWC, omitting a time
  from the data array makes the neighbouring points adjacent (⇒ a bridge). Inserting a
  `WhitespaceData` row at that time is the candidate break mechanism. **UNVERIFIED:** whether LWC
  draws a connecting segment across a whitespace row. **Experiment:** one `LineSeries`, points at
  t1/t3 with a whitespace row at t2, and count pixels on the t1→t3 segment. If whitespace does not
  break, `linebr` needs N sub-series per run or one SPRIM.
- `trackprice = true` maps **natively** and cleanly onto `SeriesOptionsCommon`:
  `{priceLineVisible: true, priceLineSource: PriceLineSource.LastBar (0), priceLineStyle: Dotted,
  priceLineWidth, priceLineColor}` — a full-width line at the last value is exactly what
  `trackprice` describes.
- `format` / `precision` → `SeriesOptionsCommon.priceFormat: PriceFormat`
  (`= PriceFormatBuiltIn | PriceFormatCustom`). `format.volume`'s abbreviation ("5183" → "5.183K")
  needs `PriceFormatCustom`. **UNVERIFIED:** the member names of `PriceFormatBuiltIn` /
  `PriceFormatCustom` — `[5A]` names the union but does not quote its fields. Read the typings
  before coding this.
- `show_last = N` is **na-masking, not clipping** `[4A]` §1.4 — drop the older points from the data
  array so `style_line` has nothing to bridge from. Do not draw a bridge into the visible region.
- `display` is **set arithmetic**, not integer arithmetic: `+`/`-` are supported and repeated
  subtraction of the same flag is a documented no-op `[4A]` §1.5.
- Pine's plot-count ceiling is **64** `[4D]` §4.6 ⇒ at most 64 series per script. LWC documents no
  series cap.

**Row 2 — `label.new`.** `[REF6]` gives two overloads (`(point, …)` and `(x, y, …)`) and 13
parameters; `[REF6]` also gives **21** `label.style_*` members (`arrowdown, arrowup, circle, cross,
diamond, flag, label_center, label_down, label_left, label_lower_left, label_lower_right,
label_right, label_up, label_upper_left, label_upper_right, none, square, text_outline,
triangledown, triangleup, xcross`) and **3** `yloc.*` members (`abovebar, belowbar, price`).
21 styles against 4 marker shapes settles the mechanism by itself. `size` is `series int/string`
(any positive integer, or the 6 `size.*` constants).

y-anchoring: `yloc.price` ⇒ `series.priceToCoordinate(y)`; `yloc.abovebar` / `yloc.belowbar` ⇒
`priceToCoordinate(high)` / `(low)` ± an offset, and `y` is **ignored**.

**Row 4 — `fill`, three overloads.** `[4B]` §1: (A) plot↔plot solid, (B) hline↔hline solid,
(C) plot↔plot vertical gradient (`top_value`, `bottom_value`, `top_color`, `bottom_color`) — and
each overload has a **different positional order**. `[4B]` §1.4 rules that overload C must also
accept `(hline, hline, …)` (the reference's own example and the current FAQ both do it); the
`plot`-only typing in the reference data is a documentation defect. `fillgaps = false` ⇒ close the
region at the gap; `fillgaps = true` ⇒ bridge it. `fill()` does **not** work with `line` objects —
that is `linefill`'s job.

**Row 6 — `box.new`.** `[4D]`: `border_style` accepts only **3** of the 6 `line.style_*` members
(no arrows); all four borders share one colour, one width, one style (no per-side anything);
`bgcolor` and `border_color` both default to `color.blue`; `extend.*` extends **only the horizontal
borders**, indefinitely (whether the `bgcolor` fill extends with them is UNVERIFIED); a zero-area
box and an all-`na` box both still exist and still consume a budget slot; `text_wrap` interacts with
`text_size == 0` (auto) such that the *default* combination can never wrap.

**Row 7 — `table.new` / `table.cell`.** `[4E]`: exactly **9** `position.*` anchors, **one displayed
table per anchor** (last writer silently wins, no error), `columns`/`rows` immutable after
construction, no getters, cells sized either intrinsically (widest text) or as a **% of the pane's
visual space**, and — decisively for the mechanism — *"tables are anchored to the pane space itself,
not to any x or y chart coordinates… they remain fixed in size and position when zooming into or
scrolling across the chart."* There is **no documented row/column/cell maximum** (UNDOCUMENTED —
pick a defensive ceiling and log when it is hit). `text_formatting` is additive
(`format_bold + format_italic`). Only `force_overlay` is `const`; everything else accepts `series`.

**Row 14 — `chart.point`.** `[4D]` §6: four constructors plus `copy`, fields `{time, index, price}`,
and an `xloc`-compatibility matrix. The renderer contract: `xloc.bar_time` coordinates are **UNIX
milliseconds**, LWC `UTCTimestamp` is **seconds** — divide.

**Note M — setters, getters and deleters need no LWC counterpart.** 20 `box.set_*`, 4 `box.get_*`,
the whole `line.set_*` / `line.get_*` family, `label.set_*`, `table.cell_set_*`, and every
`*.delete` mutate a **model** inside a layer primitive and then call `requestUpdate()`. Because a
layer owns an array of models rather than one LWC object per Pine object, `line.set_x2` (533 sites)
is an array write, not a renderer call. This is the single largest architectural payoff of the
layer design — and it is why `line.delete` (20.4%, 1,637 sites) and `label.delete` (19.1%,
1,343 sites) cost nothing.

Pine's own budgets, which bound every layer `[4D]` §4.1: **line 500 / label 500 / box 500 /
polyline 100** maxima (defaults ~50 each), four **independent FIFO pools**, oldest-first eviction,
and the caps are explicitly *"approximate"* — treat `max_*_count` as a retention floor, never
assert `count <= max`.

---

## 3. PINE'S NINE BUCKETS vs LWC'S FOUR SLOTS

### 3.1 The two orderings, verbatim

**Pine — 9 z-index groups, ascending** `[4E]` §2.5, from *Visuals / Overview*:
1 Background colors · 2 Fills · 3 Plots · 4 Horizontal levels · 5 Linefills · 6 Lines · 7 Boxes ·
8 Labels · 9 **Tables**. Within a group, *"elements created last in the script's logic appear on
top."* And the hard rule: *"An element cannot be placed outside the region of z-space that its group
occupies — for example, a plot can never appear on top of a table."*

**LWC — the real paint order**, read out of `PaneWidget.paint` in the 5.2.0 bundle `[5B]` §5:

```
MAIN canvas  (repainted only when invalidation level > Cursor)
  1. chart background fill
  2. drawSources(bottom)      ← zOrder 'bottom'
  3. drawGrid()               ← THE GRID
  4. drawSources(normal)      ← zOrder 'normal' AND the series' own pixels
  5. drawSources(labels)      ← price-line labels etc.
TOP canvas   (cleared and repainted on EVERY paint, Cursor level included)
  6. drawCrosshair()
  7. drawSources(top)         ← zOrder 'top'
  8. drawSources(labels)
```

and inside **each** `drawSources` pass, four loops in this order:
`pane primitives drawBackground` → `series sources drawBackground` → `pane primitives draw` →
`series sources draw`.

Within one series, `Series.paneViews()` returns
`[baseHorizontalLineView, seriesPaneView, priceLineView, ...customPriceLines, ...'normal' primitives]`
— so a price line paints **after** the series' own pixels, and a `'normal'` primitive paints after
both.

`PrimitivePaneViewZOrder = "bottom" | "normal" | "top"` (3 values, lowercase, default `'normal'`),
which × the `drawBackground`/`draw` split gives the **four effective slots** the docs' own explainer
enumerates: `bottom`, `normal (background)`, `normal`, `top`.

### 3.2 The reconciliation

| Pine bucket | LWC assignment | Physical position | Faithful? |
|---|---|---|---|
| **1 Backgrounds** (`bgcolor`) | `BgLayer` SPRIM, `'bottom'` + `drawBackground()` | below the grid | ✅ (see loss **L7**) |
| **2 Fills** (`fill`) | `FillLayer` SPRIM, `'normal'` + `drawBackground()` | above the grid, **below** the series pixels | ✅ exact — this is the official `bands-indicator` slot |
| **3 Plots** (`plot*`) | the series' own pixels; order among plots via `setSeriesOrder` | `seriesPaneView` | ✅ |
| **4 Horizontal levels** (`hline`) | `createPriceLine` | `priceLineView`, which paints **after** `seriesPaneView` | ✅ exact — the library already puts price lines above the series |
| **5 Linefills** | `LinefillLayer` SPRIM, `'normal'` + `draw()`, attached **1st** | above the series pixels | ✅ via attach order |
| **6 Lines** | `LineLayer` SPRIM, `'normal'` + `draw()`, attached **2nd** | " | ✅ via attach order |
| **7 Boxes** | `BoxLayer` SPRIM, `'normal'` + `draw()`, attached **3rd** | " | ✅ via attach order |
| **8 Labels** | `LabelLayer` SPRIM, `'normal'` + `draw()`, attached **4th** | " | ✅ via attach order |
| **9 Tables** | **DOM overlay** above every canvas (or PPRIM at `'top'`) | above the crosshair | ✅ — and the "plot can never sit above a table" rule then holds *structurally* |

Nine buckets land on **six distinct physical positions**, with buckets 5–8 emulated by **attach
order inside one slot**. Both primitive collections are plain arrays with `push` on attach and
`filter` on detach (`src/model/series.ts:645,649`), so *draw order within one zOrder layer is attach
order* — this is a load-bearing guarantee, not a convention. `[5B]` §1

### 3.3 The two non-obvious corrections to the generic advice

`[5B]` §14 recommends *"`drawBackground()` at `'normal'` for fills that belong under the series
(Pine `bgcolor`, `linefill`, box fills)."* **That is right for `bgcolor` and wrong for the other
two, if Pine ordering is the goal:**

- **`linefill` is Pine bucket 5 — ABOVE the plots (bucket 3).** In `drawBackground` it would render
  *below* every plot. Linefills go in `draw()`.
- **A box's `bgcolor` fill is part of bucket 7 — also above the plots.** Drawing box fills in
  `drawBackground` for the sake of translucency sinks them below the plot lines. Box fills go in
  `draw()`, and a translucent box fill correctly tints the plots it covers — which is what Pine
  does.
- Only **`fill()`** (bucket 2) genuinely belongs in `drawBackground`, and `bgcolor` (bucket 1)
  belongs further down still, at `'bottom'`.

### 3.4 Where the emulation is lossy

| # | Loss | Why | Mitigation |
|---|---|---|---|
| **L1** | Any *other* `'normal'` primitive attached to the same host series after `LabelLayer` jumps above the labels | attach order is the only ordering inside a slot; there is no id, no dedupe, no cap `[5B]` §1 | attach all layers from **one** place, in one fixed order, and never let application code attach to the drawings' host series |
| **L2** | If plots live on several series and the drawing layers on one host, a plot on a series that paints *after* the host lands above the drawings | `'normal'` primitives are collected per series source, in source order | the drawings' host series must sort **last** in its pane. Mechanism: `ISeriesApi.setSeriesOrder(order)` — signature confirmed `[5A]` §2.3, **semantics UNVERIFIED** (whether it drives `orderedSources()` / paint order is not quoted anywhere). Confirm before relying on it |
| **L3** | **`explicit_plot_zorder = true` is only partly expressible.** It collapses buckets 2/3/4 into source-call order `[4E]` §2.5 | fills can move above plots (`draw` instead of `drawBackground`) and plots can be reordered (`setSeriesOrder`), but an **hline cannot be pushed below a plot**: `priceLineView` is hard-wired after `seriesPaneView` inside `Series.paneViews()` | when `explicit_plot_zorder = true`, stop using `createPriceLine` for `hline` and render hlines inside the ordered primitive layers. Arbitrary interleaving of fills *and* plots *and* hlines in one sequence would need all three inside one primitive or one custom series |
| **L4** | **`behind_chart` defaults to `true`** — *all* plots and drawings must appear **behind the chart display** when `overlay = true` `[4E]` §2.6 | the main candles are just another series; there is no "chart layer" to hide behind | give the main price series the **highest** `setSeriesOrder` in the pane so it paints last in the `draw` sub-pass, above the script's series pixels *and* its `'normal'` primitives. Preserves the script's internal bucket order exactly. Depends on L2's UNVERIFIED semantics; the fallback (move every layer to `drawBackground`) preserves attach order but flattens bucket 2 into the same sub-pass as 5–8 |
| **L5** | A table as a **pane** primitive at `'normal'` sits **beneath** every series primitive | *"In every `_drawSources` pass, all pane primitives are drawn before all series sources, in both the background and foreground sub-passes… You cannot reorder that."* `[5B]` §3 Trap 1 | tables are `'top'` or DOM. **Non-negotiable** — this is the mechanism that enforces Pine's own non-negotiable rule |
| **L6** | `'top'` shares the top canvas with the crosshair and is re-`renderer()`-ed and re-`draw()`-n on **every mouse move** (`updateAllViews` is *not*) | the top-canvas block sits outside the `if (type !== InvalidationLevel.Cursor)` guard `[5B]` §5 | DOM tables sidestep it entirely. Cost of not doing so: 2,285 cell sites' worth of `fillText` per mousemove. Note the trade: a DOM overlay is **not** in `takeScreenshot()` |
| **L7** | `bgcolor` at `'bottom'` renders **below the chart grid**. Whether TradingView draws its own grid above or below a Pine `bgcolor` is **UNVERIFIED** | Pine's 9 buckets describe only Pine elements; the grid is chart furniture and is not in the list | if above-grid parity turns out to be right, move `BgLayer` to `'normal'` + `drawBackground()` and attach it before `FillLayer`. One-line change; decide it by looking at the product |
| **L8** | A pane loses its primitives if its last series is removed (the library prunes empty panes) `[5B]` §3 Trap 2 | | never rely on an empty pane; the DOM table's lifecycle must tolerate `detached()` firing from a prune |

---

## 4. TEXT RENDERING — the complete build list

**What LWC gives you for text, exhaustively** `[5B]` §9:
1. `ISeriesPrimitiveAxisView` — `text()`, `textColor()`, `backColor()`, and the library draws the
   pill, the tick, **and resolves overlaps**. This is the *entire* text feature surface exposed to
   plugins.
2. `createSeriesMarkers` draws a per-marker `text?: string` — one line, no pill, **no de-overlap**.
3. `DrawingUtils.setLineStyle` — which is about dashes, not text.

**There is no text API for pane renderers.** No layout, no measurement helper, no pill, no
multi-line, no wrapping, no ellipsis, no baseline correction, no collision avoidance. A primitive
that draws text does `ctx.font = …; ctx.measureText(…); ctx.fillText(…)` and everything else by
hand.

### 4.1 Everything a Pine label / box-text / table must therefore build

| # | Capability | Pine's requirement | What we build | Vendorable starting point (all Apache-2.0) |
|---|---|---|---|---|
| 1 | **Font string** | `font.family_default` \| `font.family_monospace`; `text_formatting` = `format_none`/`format_bold`/`format_italic`, **additive** | `makeFont(size, family, style)` and a Pine-format → CSS-style-prefix map | `src/helpers/make-font.ts` (~28 lines) — default stack `-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif`. Match it or labels won't look native |
| 2 | **Size enums → px** | `size.*` = auto/tiny/small/normal/large/huge, **plus any positive integer**. Documented int equivalents: tables & boxes `0/8/10/14/20/36`; labels `0/~7/~10/12/18/24` `[4A]` §9.5, `[4D]` §1.5 | one table, two columns (box/table vs label), plus an arbitrary-int path | — |
| 3 | **`size.auto`** | *"Adjusts the size of the graphics automatically."* TV's actual rule is **undocumented** | our own bar-spacing-derived rule, flagged as non-parity | — |
| 4 | **Width measurement, cached** | thousands of labels + 2,285 table-cell sites; `measureText` is not free at hundreds of calls per frame | an LRU over `TextMetrics` | `src/model/text-width-cache.ts` (~70 lines): LRU `size = 50`, keys with digits `[2-9]` normalised to `0` so `"1,234"` and `"1,567"` share an entry, and it refuses to cache a `width === 0` result *"because measureText can return 0 in FF depending on a canvas size"* |
| 5 | **Vertical centring** | `text_valign = center`, and every bar-anchored label | `yMidCorrection(ctx, text) = ((m.actualBoundingBoxAscent \|\| 0) - (m.actualBoundingBoxDescent \|\| 0)) / 2` | same file. The `\|\| 0` fallback is for browsers lacking `actualBoundingBox*`. This is the thing you would otherwise reinvent wrongly |
| 6 | **Multi-line** | `label` text takes `\n`; `plotshape`/`plotchar` `text` takes `\n` **and** uses leading/trailing `\n` as a *stacking* device (trailing lifts up, leading pushes down) `[4A]` §2.2 | per-line `lineHeight` + `vertOffset`, a pre-pass summing `textHeight`, `vertAlign`→`vertOffset`, `horzAlign`→`ctx.textAlign` + `horzOffset`, `textBaseline = 'top'`, `translate` then one `fillText` per line | `src/plugins/text-watermark/pane-renderer.ts` — **the only multi-line implementation in the whole library.** ⚠️ it *auto-shrinks* (`line.zoom = mediaSize.width / textWidth`) rather than wrapping |
| 7 | **Word wrapping** | `text.wrap_auto` on boxes: break at the box's left/right edges, **clip anything below the bottom edge**; `text.wrap_none` overflows horizontally without clipping; and `text_size == 0` disables wrapping entirely `[4D]` §2.4 | real greedy word wrap + a bottom-edge clip | **nothing** — *"there is no word wrapping anywhere in the library"* |
| 8 | **Background pill + border** | `label.color` (the pill), the 21 `label.style_*` holder shapes, `box.border_color`/`border_width`/`border_style`, `table` `bgcolor`/`frame_*`/`border_*` | rounded rects with per-corner radii | `src/helpers/canvas-helpers.ts`: `drawRoundRect`, `drawRoundRectWithBorder(ctx, left, top, w, h, backgroundColor, borderWidth, outerBorderRadius, borderColor)` with per-corner radii `[lt, rt, rb, lb]`, `fillRectInnerBorder`. ⚠️ **`drawRoundRectWithBorder` explicitly assumes opaque colours** ("This allows us to fix a rendering artefact") — a translucent Pine `color` will show a border/background seam, so fill and stroke separately for those |
| 9 | **Alignment** | `text.align_*` — 5 members; halign ∈ {left, center, right}, valign ∈ {top, center, bottom}, both default `center` | `ctx.textAlign` + explicit offsets; valign from the measured block height | see #6 |
| 10 | **De-overlap** | Pine renders every label; TradingView's own placement is not specified, but a dense chart must not be a smear | measure → natural anchor → sort by x → greedily push vertically / flip side / drop → **cache**, keyed on (visible range, bar spacing, data rev, text rev) — and run it in `updateAllViews()`, **never** in `draw()` | **nothing.** See §4.2 |
| 11 | **DPR-correct fonts** | | scale the font size by the pixel ratio inside `useBitmapCoordinateSpace` | ⚠️ **the official `trend-line` example gets this wrong** — it hardcodes `'24px Arial'` in a bitmap scope while scaling its offsets by `scope.horizontalPixelRatio`. Copy its geometry, not its font handling |

### 4.2 The de-overlap finding, stated plainly

**LWC de-overlaps price-axis labels ONLY.** Confirmed by reading the source: the library has
**exactly one** overlap resolver — `recalculateOverlapping()` at `src/gui/price-axis-widget.ts:77`
with `_fixLabelOverlap()` at `:640` — and a grep for `overlap|collision|declutter` across `src/`
returns only price-axis-widget hits plus doc comments. `createSeriesMarkers` supports `text` and
performs **no** collision detection. There is no label-placement engine, no priority/decluttering
system, and no "hide on collision" option anywhere. `[5B]` §9, §11(e)

Consequence: `ISeriesPrimitiveAxisView.coordinate()`'s promise — *"the label will be automatically
moved to prevent overlapping with other labels"* — is the **only** free de-overlap in the product,
and it applies to axis labels. `fixedCoordinate()` opts out of it (and such labels paint above
unfixed ones; the docs say return a large negative `coordinate()` so the auto-placer reserves no
slot).

`[5B]`'s own verdict is the one to budget against: *"this is the item most likely to be
under-estimated, because 'draw text at a coordinate' looks done after an hour and then looks wrong
on every dense chart."*

**⭐ We have already built it twice, and one of the two is a complete engine.** This is the single
largest correction to the schedule this map can offer `[REPO]`:

| Existing | What it does | Fitness for `LabelLayer` |
|---|---|---|
| `app/src/components/chart/swingLabelsPrimitive.js:36-71` | `intersects(rect, drawn)` — a "light de-clutter" that **skips** a colliding label. Draws at `zOrder: 'top'` | the cheap policy (drop on collision), already inside a real `ISeriesPrimitive` |
| **`app/src/components/chart/ChartCalloutOverlay.jsx`** (459 lines) | A full measure → search → cache → collide placer: a per-frame candle occupancy map from visible high/low pixels; `hitsCandles`, `rectsOverlap` (6px/4px slop), `lineHitsCandles` (parametric segment vs candle extent, skipping its own candle), `segCross` (leader-line ⇄ leader-line interior intersection); `splitTwo`/`wrapLabel`/`boxDims` text wrapping from `measureText` (`textH 13, padX 5, padY 3`); a **4 diagonal directions × 10 distances** cost-ranked search `[20,28,38,50,64,82,104,132,168,210]`; plot-area clamping via `series.priceScale().width()`; and a `placeRef` offset cache keyed `` `${time}|${text}` `` so the search runs only on change while labels **ride the cached offset** during pan/zoom | **this is the `LabelLayer` placement pass.** It already solves the hard parts — occupancy, leader lines, wrapping, cost ranking, and the cache invalidation policy. It needs porting from a sibling canvas into a primitive's `updateAllViews()`, not designing |

It also already solves a driver problem the Pine layers will hit: a **vertical price-axis drag fires
no range event**, so its rAF loop samples `priceToCoordinate(1)` / `priceToCoordinate(100)` as a
change signature (`:367-457`) and does zero redraws when idle. And it resolves chart/series from refs
**every frame** — the comment names the bug that taught it: *"a one-time capture left this tracker
dead when the overlay mounted before the chart existed… See the matching fix in ChartDrawingOverlay
(the 'trendline doesn't stay put' bug)."*

### 4.3 Canvas or DOM — per case, with the reason

| Case | Verdict | Why |
|---|---|---|
| **Pine `label.new`** (2,852 sites) | **CANVAS** (SPRIM) | Bar-anchored: it must move with every pan/zoom frame. Up to 500 live labels. Repositioning 500 DOM nodes per frame is worse than 500 `fillText`s. (For the screenshot argument, see the ⚠️ below — it is weaker than it looks) |
| **Pine label / cell `tooltip`** (314 + 267 sites) | **DOM** | One node, shown on hover. `hitTest` gives you the id; the official `tooltip` plugin (`tooltip-element.ts`) builds an HTML `div` deliberately. There is no canvas tooltip and no reason to invent one |
| **Pine `box` text** | **CANVAS** | Geometrically inside the box, wrapped and clipped to the box's own rect. Splitting a box's fill/border (canvas) from its text (DOM) would desynchronise them on every frame |
| **Pine `table`** (307 + 2,285 sites) | **DOM** overlay, lifecycle owned by a PPRIM | Pane-anchored and *immune to pan/zoom* `[4E]` §1.9(f) — so it does **not** need per-frame repositioning, which removes canvas's only advantage. Then: text is **selectable, copyable, searchable and reachable by assistive technology**; `text_font_family` and `text_formatting` are CSS; per-cell `tooltip` is a `title` attribute; `width`/`height` as % of the pane is CSS `%`. And it avoids L6 entirely (no top-canvas redraw per mousemove). The official `tooltip` and `accessibility` plugins both do exactly this. **Canvas only if a table must appear in a canvas export** |
| **Legend / status line / indicator title / value readout** | **DOM** | *"LEGEND / STATUS LINE: NOT PROVIDED."* `[5A]` §2.10 — no legend API, no status-line API, no per-series label rendering. `SeriesOptionsCommon.title` feeds only the price-scale last-value label. The library's own answer is "subscribe to crosshair move and render your own HTML," which is what our `StockChart.jsx` crosshair overlay already does |
| **Price-scale labels** for `hline` / a drawing's level | **CANVAS, via `ISeriesPrimitiveAxisView`** | The one place the library does the layout *and* the de-overlap for you. Use it rather than drawing axis text yourself |

Accessibility, stated once: **canvas text is not selectable, not searchable, not copyable and
invisible to assistive technology.** For a 2,285-call-site table surface that is not a stylistic
preference; it is the reason tables are DOM.

### 4.4 ⚠️ The screenshot argument is weaker than the docs imply — reconcile it before leaning on it

`[5A]` §2.10 quotes `takeScreenshot(addTopLayer?, includeCrosshair?)` as *"if true, the top layer and
primitives will be included in the screenshot (default: false)"*, and §2.11 uses that to argue a
primitive is captured while a sibling canvas is not.

**Our production screenshot path says primitives are missed in practice.** `[REPO]`
`app/src/components/chart/chartScreenshot.js:113-115`:

> *"LWC's `takeScreenshot()` = ONLY the chart canvases (candles, axes, MAs, volume bars, watermark).
> It never includes the DOM toolbar, the drawing-overlay canvas, or the DOM legend/vol text — so
> those are composited/redrawn below."*

and `:192-193` redraws a primitive by hand: *"Redraw swing-high/low price labels (**a top-zOrder
primitive takeScreenshot misses**). Mirrors `swingLabelsPrimitive`."*

**Most likely reconciliation:** the default is `addTopLayer = false`, and our call site does not pass
`true`, so `'top'`-layer primitives are legitimately excluded. That is consistent with both
statements — but it has never been tested with `addTopLayer = true`. **UNVERIFIED. Experiment:**
call `takeScreenshot(true)` and check whether the swing labels appear; if they do, delete the
hand-redraw in `chartScreenshot.js` and the "canvas is in the export" argument becomes real.

Until then, the honest ranking of the canvas-vs-DOM decision is: **per-frame repositioning cost and
z-order participation are the real reasons to choose canvas; capture is not yet one of them.** Today
there are **three separate rendering worlds** — LWC canvases, LWC primitives, and sibling overlay
canvases — reconciled by hand in `chartScreenshot.js:113-230`. **Moving the Pine layers into
primitives reduces that to two; getting `addTopLayer = true` working reduces it to one.**

---

## 5. THE COORDINATE AND AUTOSCALE HAZARDS — rules to obey

Each rule is followed by the source that makes it true. Rules 1–4 are the ones `[5B]` flags as
"will cost a day each."

**R1 — `logicalToCoordinate` on a non-integer returns `0`, not `null`.** Read the implementation:

```js
indexToCoordinate(index) {
    if (this.isEmpty() || !isInteger(index)) return 0;      // ← returns 0, not null
    const deltaFromRight = baseIndex + rightOffset - index;
    return width - (deltaFromRight + 0.5) * barSpacing - 1;
}
// isInteger(v) = typeof v === 'number' && (v % 1) === 0
```

`logicalToCoordinate(3.5)` gives a silently wrong coordinate pinned to the **left edge of the
pane**. No error, no warning. **Guard every call site: pass integers only.** For sub-bar positions,
take one integer anchor's coordinate and add `fraction * timeScale.options().barSpacing` yourself.
`[5B]` §8

**R2 — `timeToCoordinate` returns `null` for any time not exactly on the time scale** — a time
inside a data gap, a weekend, a holiday, or any date beyond your data. A drawing anchored at
`bar_index + 20` or at a wall-clock time you never fed the chart simply refuses to resolve. `[5B]`
§8, `[5A]` §2.8

**R3 — the recipe for coordinates beyond the data range.** `[5B]` §8 reads the formula as purely
affine in `index` with no clamping, so integer logical indices outside the data *should* extrapolate
correctly:

1. Convert the Pine anchor to an **integer logical index** in our own code — `timeToIndex(t, true)`
   for a nearby real time, or `lastIndex + n` for a future offset.
2. Call `logicalToCoordinate(thatInteger)`.
3. Never pass a fraction; see R1.

⚠️ **But our own production code contradicts the "no clamping" reading, and it was measured.**
`origin/master:app/src/components/chart/ChartDrawingOverlay.jsx:1191-1210` carries the comment
*"Robust fallback: logicalToCoordinate returns null for a logical index beyond the extrapolatable
right-pad (seen on INTRADAY)"* and implements the cascade that survives it — take two **integer**
endpoints of the visible logical range and interpolate linearly:

```js
const targetLogical = (bars.length - 1) + futureBars
try { x = chart.timeScale().logicalToCoordinate(targetLogical) } catch {}
if (x == null) {
  const range = chart.timeScale().getVisibleLogicalRange()
  if (range) {
    const lo = Math.ceil(range.from), hi = Math.floor(range.to)     // ← integers, per R1
    const xa = chart.timeScale().logicalToCoordinate(lo)
    const xb = chart.timeScale().logicalToCoordinate(hi)
    if (xa != null && xb != null && hi !== lo) x = xa + (targetLogical - lo) * ((xb - xa) / (hi - lo))
  }
}
```

**Rule: every `logicalToCoordinate` on a future index needs this fallback**, and the fallback must
round `range.from` up and `range.to` down (R1). `FUTURE_BARS_CAP` there is **500**, which is exactly
Pine's own forward x-clamp. `[REPO]`

**R4 — the whitespace / future-bar anchoring recipe.** Two mechanisms, and they are not
interchangeable `[5A]` §2.8:

- **(A) `WhitespaceData` future slots — use this whenever anything must be *anchored*.** Every
  built-in series' data union accepts `WhitespaceData` (`{ time, customValues? }`), so `setData()`
  with entries carrying **future timestamps and no value** creates real time-scale points past the
  last bar. Those slots then have real coordinates, so `timeToCoordinate` resolves, markers and
  price lines dock onto them, and a primitive can paint there. Two facts in the shipped typings
  prove the forward case: `allowShiftVisibleRangeOnWhitespaceReplacement` ("a new bar … replacing an
  existing whitespace time point") only makes sense if whitespace exists *ahead of* the data, and
  `ignoreWhitespaceIndices` (default `false`) exists precisely because whitespace-only indices **are**
  time-scale points by default.
- **(B) `rightOffset` / `setVisibleLogicalRange` — breathing room only.** These give you pixels, not
  addressable slots: there is no `time` there, `timeToCoordinate` returns `null`, and a marker has
  nothing to attach to.
- **The pattern is already shipped and proven in our own code.** `origin/master:app/src/components/StockChart.jsx`
  has `buildFutureWhitespace(lastLwcTime, tf, minCount, targetSlot = null)` (~line 1404) feeding a
  dedicated hidden `LineSeries` — *"Hidden line series carrying FUTURE whitespace (empty time slots
  past the last [bar]) … so an upcoming-earnings marker can dock onto its real day"* (~line 3132)
  and *"Future-axis extension: a hidden whitespace series pushes the time scale past the [last
  bar]"* (~line 6268). **Reuse it.**
- ⚠️ Future slots must land on the **correct calendar grid** for the timeframe.
  **LWC has no trading-session, holiday or calendar model at all.** Ours already does it, and the
  detail is the point: intraday steps by `PERIOD_SECONDS[tf] || 300`; `'D'` steps a day and
  `continue`s on `dow === 0 || dow === 6` **and** on `isHolidayISO(fmt(cur))` (*"no bar exists on a
  closed weekday like Labor Day → no phantom axis slot"*); `'W'` adds `7 * 86400000` in UTC
  ("Friday → Friday, DST-proof"); `'M'` uses `Date.UTC(y, month + 1, 1)`. Guards: `HARD_CAP = 260`,
  loop guard `HARD_CAP * 8`, and a per-timeframe floor
  `FUTURE_MIN = { '1':90, '5':30, '15':30, '30':24, '60':24, D:40, W:20, M:14 }`. `[REPO]`
- Pine's forward x-clamp for `xloc.bar_index` is **+500 bars** and its backward floor is
  **`bar_index - 10000`** `[4D]` §2.2 — those bound how many future slots we ever need, and +500 is
  already `ChartDrawingOverlay`'s `FUTURE_BARS_CAP`.

**R5 — a drawings-only host series must carry at least one REAL data point.** Primitive
`autoscaleInfo` is **never called** if the host series has no data, and whitespace **does not
count**: the data layer filters whitespace rows out of the plot list
(`src/model/data-layer.ts:427` — `seriesRows.filter(isSeriesPlotRow)`), so a whitespace-only series
has `isEmpty() === true`. `[5B]` §8

```js
if (!isInteger(startTimePoint) || !isInteger(endTimePoint) || this._data.isEmpty()) {
    return null;                                     // ← primitives never consulted
}
```

Note the same guard also confirms R1's flavour: **non-integer bounds skip the whole autoscale
computation.**

**R6 — `AutoscaleInfo.margins` is OVERWRITTEN, not merged, across primitives — last attached
wins.** `priceRange` *is* unioned; `margins` is a bare assignment in the forEach `[5B]` §8:

```js
this._primitives.forEach(primitive => {
    const a = primitive.autoscaleInfo(startTimePoint, endTimePoint);
    if (a?.priceRange) range = range !== null ? range.merge(primitiveRange) : primitiveRange;
    if (a?.margins)    margins = a.margins;          // ← LAST writer wins, not merged
});
```

**Rule: exactly ONE layer may return `margins`** — the `LabelLayer`, because pill height is the only
thing that needs pixel headroom. Every other layer returns `{ priceRange, margins: undefined }`.

**R6b — an explicit `autoscaleInfoProvider` price range is used EDGE-TO-EDGE: it does NOT receive
the price scale's `scaleMargins`.** This is a measured, production-documented finding of ours, not a
doc claim — `origin/master:app/src/components/StockChart.jsx:11443-11458`:

> *"An explicit `autoscaleInfoProvider` price range is used **EDGE-TO-EDGE** by lightweight-charts —
> it does NOT get the price scale's `scaleMargins` (those only pad the default autoscale)."*

The shipped answer bakes the margins into the returned range itself (`_padVert`, `:11450-11459`):

```js
const mt = Math.max(0, Math.min(0.45, _mm?.top ?? 0))
const mb = Math.max(0, Math.min(0.45, _mm?.bottom ?? 0))
const denom = 1 - mt - mb
const R = (r.hi - r.lo) / denom
return { lo: r.lo - mb * R, hi: r.hi + mt * R }
```

**Rule: any layer or provider that returns a `priceRange` must apply the pane's `scaleMargins`
itself, with `_padVert`.** Reuse that function; do not re-derive it. `[REPO]`

**R7 — returning `null` from `autoscaleInfo` means "no opinion", and is the correct answer when your
drawing is off-screen.** The official `volume-profile` returns `null` when its index range does not
intersect `[startTimePoint, endTimePoint]`. `[5B]` §8

**R8 — a custom `autoscaleInfoProvider` wraps a base value that ALREADY includes every primitive's
contribution, so it can silently discard them.** `series.applyOptions({ autoscaleInfoProvider })`
wraps `_autoscaleInfoImpl`. `[5B]` §8 Our own `pool.js` already encodes both safe values as
module-level singletons: `AUTOSCALE_EXCLUDE = () => null` and
`AUTOSCALE_DEFAULT = (baseImplementation) => baseImplementation()`. **Never write
`() => ({ priceRange: … })` on a series that hosts drawing primitives** — use
`baseImplementation()` and widen the result.

**R9 — `autoscaleInfo` runs on every scroll and zoom frame.** The documented warning, verbatim:
*"this method will be invoked very often during scrolling and zooming of the chart, thus it is
recommended that this method is either simple to execute, or makes use of optimizations such as
caching."* The sanctioned shape is `bands-indicator`'s: a prebuilt `UpperLowerInRange` min/max
segment tree plus a `ClosestTimeIndexFinder`, rebuilt only on a `'full'` data change, so
`autoscaleInfo` is two index lookups and a range query. `[5B]` §8, §12

**R10 — every coordinate the library hands you is in MEDIA (CSS) pixels.** `priceToCoordinate`,
`timeToCoordinate`, `logicalToCoordinate`, `CustomBarItemData.x`, and `PriceToCoordinateConverter`
output. Inside `useBitmapCoordinateSpace` you must multiply each one yourself — **including font
sizes.** `[5B]` §4

**R11 — `horizontalPixelRatio !== verticalPixelRatio` in general, and neither equals
`window.devicePixelRatio`.** They are derived: `bitmapSize.width / mediaSize.width` and
`bitmapSize.height / mediaSize.height`. Never substitute `devicePixelRatio`. `[5B]` §4

**R12 — do all coordinate work in `updateAllViews()`; keep `draw()` to pure canvas calls.**
`updateAllViews()` runs on every Light-or-Full invalidation (data, options, scroll, zoom, resize)
but **not** on a Cursor-level invalidation (plain mouse move). A `'top'` view that computes
coordinates inside `draw()` burns that work on **every mouse move**. `[5B]` §2, §5

**R13 — view getters are cached by ARRAY REFERENCE, and renderers by OBJECT reference.** Verbatim on
all five getters: *"this method must return new array if set of views has changed and should try to
return the same array if nothing changed."* `PrimitivePaneViewWrapper.renderer()` caches its wrapper
when `paneView.renderer()` returns the same object. Returning a freshly-allocated renderer every
frame costs an allocation per view, per layer, per paint. `[5B]` §2

**R14 — `PrimitiveHoveredItem.zOrder` is a REQUIRED field you assert yourself, and it drives
arbitration.** The library does not derive it. A wrong value silently corrupts hover arbitration —
`'top'` hits return immediately and beat every built-in hit test. Also set `hitTestPriority`
correctly: `0` for range hits (boxes, fills), `1` for line hits (lines, polylines), `2` for point
hits (labels, shapes) — point-style hits get special precedence. `[5B]` §6

**R15 — on click, the identified object is whatever the PREVIOUS mouse move resolved.** `hitTest` is
invoked only from the crosshair-move path; the click handler reads the already-computed hovered
source. On touch, where a tap may not be preceded by a move, this is fragile — **UNVERIFIED**
whether the library synthesises a position update before a tap-click on all touch paths. `[5B]` §6

**R16 — pick the `null`-coordinate survival tactic deliberately.** Two idioms exist in the official
examples: `bands-indicator` substitutes a sentinel (`timeScale.timeToCoordinate(d.time) ?? -100`)
so a filled region still closes off-screen; `trend-line` and `rectangle-drawing-tool` bail out
entirely (`if (this._p1.x === null || …) return;`). **The sentinel for filled regions
(`fill`, `linefill`, `box`, closed `polyline`), the bail-out for strokes and labels.** `[5B]` §8

**R17 — clipping is per-widget only.** Each pane, price axis and time axis is a separate canvas, so
drawing is clipped to that widget's rectangle. A drawing cannot spill over the price scale, but it
**can** spill over the whole pane — clip with `ctx.rect` + `ctx.clip` yourself if you need less.
`[5B]` §8

**R18 — data conflation will silently merge your plot's points when zoomed out.** 5.1.0+ merges
points when bar spacing puts them under ~0.5 px. **Primitives do not participate in conflation at
all**; custom series opt in via `conflationReducer`. For Pine parity, consider the time-scale
`enableConflation` option (named in the 5.1.0 release notes per `[5B]` §10; exact field placement
**UNVERIFIED** in the typings). `[5A]` §1, `[5B]` §10

**R19 — a zero-size pane silently draws nothing.** Both rendering scopes throw at construction if
media or bitmap size has a zero dimension, and the library uses
`tryCreateCanvasRenderingTarget2D` and simply skips the paint. Do not diagnose an empty pane as a
data bug. `[5B]` §4

**R20 — overlay price scales are ALWAYS auto-scaled and ALWAYS hidden.** *"Note that overlay price
scales are always auto-scaled."* An RSI overlaid on price cannot be pinned to 0–100 on an overlay
id; `'left'` is the only second *visible* scale slot per pane. And — measured in our own
`__tests__/autoscaleOnARealScale.test.js` — **`minimum` / `maximum` are NOT LWC 5.2.0 price-scale
options**: `merge` copies them into the options bag and nothing reads them (RSI's band comes back
`30.0002..69.9957`, not `0..100`). What `autoScale: false` really does is freeze the scale at the
**previous tenant's extent**. `[5A]` §2.5, `[REPO]` `placement.js`

---

## 6. COST MODEL

### 6.1 The costs, from the source rather than the docs

`[5B]` §10 derived these by reading `PaneWidget.paint`, `Series.updateAllViews` and
`pane-hit-test.ts`. **None of it is in the documentation.**

| Event | Cost, per attached primitive |
|---|---|
| Light or Full paint (data change, options change, **scroll, zoom, resize**) | 1 × `updateAllViews()`, plus — for each of the 3 pane areas × 3 zOrder layers — one `paneViews()` call and one `renderer()` call |
| **Every mouse move** | 1 × `hitTest(x, y)` **per primitive** (not per view), plus a full `renderer()` + `draw()` for every `'top'`-layer view |
| Every scroll / zoom frame | 1 × `autoscaleInfo(start, end)` per primitive |

**The cost model is per-PRIMITIVE, not per-shape.** `[5B]`'s exact words: *"500 primitives drawing
one box each is ~500× more library overhead than 1 primitive drawing 500 boxes — same pixels. This
is the central architectural constraint for a Pine port and it is nowhere in the documentation."*

**Documented limits on primitive count: there are none.** No maximum, no warning, no soft guidance
anywhere in the docs, typings or source. There is also **no `requestAnimationFrame` batching** of
your `draw` calls beyond the chart's own invalidation model, and **no automatic viewport culling of
primitive geometry** — custom series get `visibleRange`; primitives get nothing.

### 6.2 Why 500 boxes must be ONE primitive

Pine's per-type maxima are 500 lines / 500 labels / 500 boxes / 100 polylines `[4D]` §4.1. Put
those through the two architectures:

| | One primitive per Pine object | One layer primitive per Pine object *class* |
|---|---|---|
| Live primitives at Pine's worst case | **1,600** | **7** (Bg, Fill, Linefill, Line, Box, Label, Polyline) |
| `hitTest` calls per mouse move | **1,600** | **7** |
| `updateAllViews` + `paneViews` + `renderer` per paint | **1,600 ×** the 3×3 fan-out | **7 ×** |
| `autoscaleInfo` calls per scroll frame | **1,600** | **7** |
| Pixels drawn | identical | identical |

500 rectangles is trivial for canvas. 500 *primitives* is not trivial for the library. And the
failure mode is the dangerous kind: it fails as a **performance** problem at a few hundred objects
rather than as a correctness one — *"which makes it easy to ship and hard to diagnose."* `[5B]`
§11(b)

**The layer contract** (the `volume-profile` example is the shape to copy — it already draws N rows
per profile inside one primitive):

- `updateAllViews()` — recompute coordinates **only** for models intersecting
  `chart.timeScale().getVisibleLogicalRange()`; store them on the view.
- `draw()` / `drawBackground()` — one `useBitmapCoordinateSpace`, then N `positionsBox`-aligned
  `fillRect`s, **batched by `fillStyle`** to minimise state changes.
- `hitTest()` — one lookup against a coarse spatial index (bucket by x, or an interval list);
  return a single `PrimitiveHoveredItem` carrying the hit model's `externalId`.
- `autoscaleInfo()` — min/max of visible models from a cached structure; `null` when none are in
  range.

### 6.3 What needs `visibleRange` culling — i.e. what should be a custom series

Primitives get **no culling**; a custom series gets `PaneRendererCustomData.visibleRange` free and
iterates only `visibleRange.from … visibleRange.to`. `[5B]` §7, §11(f)

| Candidate | Verdict |
|---|---|
| `plot.style_histogram` with a non-default pixel bar width | **CUSTOM** — the only way to control bar width, and it gets culling + `priceValueBuilder` autoscale + crosshair + legend integration free |
| Per-bar `plotshape` / `plotchar` over a 10,000-bar dataset | **CUSTOM** if the shape count approaches the bar count; SPRIM with hand-rolled culling otherwise |
| A heatmap-shaped cell grid (Pine's documented table-as-heatmap idiom) | **CUSTOM** — there is an official `heatmap-series` implementation: `visibleRange` iteration, `fullBarWidth` + `positionsBox`, a `cellShader` colour callback, and a border-drop heuristic (`drawBorder = barSpacing > cellBorderWidth * 3`) |
| `bgcolor` over the whole dataset | **SPRIM, not CUSTOM** — a custom series paints in the series pass at `'normal'` and therefore could never sit below the grid. Hand-roll the culling |
| `box` / `line` / `label` / `polyline` | **SPRIM** — free-floating geometry is not one-uniform-width-slot-per-bar, so a custom series cannot express it |

The custom-series constraint that decides all of this, verbatim: *"These series are expected to have
a uniform width for each data point."* And: there is exactly **one renderer per custom series**, so
a Pine script that plots five things needs five series (or one primitive doing all five). `[5B]` §7

Honest ceiling: a custom-series heatmap is one `fillStyle` assignment + one `fillRect` per visible
cell per paint. Thousands of visible cells is comfortable; tens of thousands starts to hurt, and the
mitigations (quantise colours into batched paths, or blit an offscreen canvas / `ImageData`) are
**not documented and not exemplified**. The actual frame-time ceiling is **UNVERIFIED** — no
benchmark exists in the repo or docs. `[5B]` §11(f)

### 6.4 Other cost rules

- **`'top'` is for tiny always-on-top chrome only.** It redraws on every mouse move (§3.4 L6). Heavy
  geometry belongs at `'normal'`.
- **`setMarkers` is a wholesale replace** — no add-one, no remove-one. Marker updates are always a
  full array swap. Marker count is unbounded in the API; the practical bound is re-layout on every
  viewport change. `[5A]` §2.6
- **`setData` is a full replace and the docs recommend against it for updates**: *"We do not
  recommend calling `ISeriesApi.setData` to update the chart, as this method replaces all series
  data and can significantly affect the performance."* So a `barcolor` recolour should go through
  `update(bar, historicalUpdate?)` where the shape allows. `[5B]` §10
- **`removeSeries` at scale is a known cost.** Our own `pool.js` records it: *"lightweight-charts
  issue #2049 (still open): a mass `removeSeries` costs 2-4 s of blocked main thread, and
  `StockChart` already does that pattern roughly thirty times per symbol flip."* The engine's answer
  is **pooling** — `applyOptions` + `moveToPane` instead of remove-and-recreate. A Pine renderer
  that creates and destroys series per script edit must reuse the same pool.
- **`positionsBox` returns `length = |Δ| + 1`.** Deliberate (adjacent boxes touch); subtract 1–2 px
  back when you want gaps. `[5B]` §4
- **`calculateColumnPositionsInPlace` over `calculateColumnPositions`**, and the toolkit's own
  advice: *"It is recommended that you memoize the majority of the calculations below to improve the
  rendering performance."* `[5B]` §10
- **Integer bitmap coordinates**: *"all drawing actions should use integer positions and dimensions
  when on the bitmap coordinate space"* — correctness *and* speed. Exception: curves, where you
  should **not** round intermediate points. `[5B]` §4, §11(d)
- **Pin `minimumWidth` on any price scale that updates live.** `[REPO]` `StockChart.jsx:9740-9744`
  records that v5's shared axis column **re-flows once per second** on live volume updates unless
  `minimumWidth` is pinned. A Pine indicator whose last value changes every tick will do the same.
- ⚠️ **Our existing primitives violate R12, and at `'top'` that costs per-mousemove work.** All six
  shipped modules use `updateAllViews: () => {}` (empty) and do their coordinate work inside
  `draw()`; five of them declare `zOrder: 'top'`, which is re-`renderer()`-ed and re-`draw()`-n on
  **every mouse move**. That is affordable for one badge glyph and is *not* affordable for a Pine
  `LabelLayer`. **Do not copy that shape into the Pine layers** — put the coordinates in
  `updateAllViews()` and keep the heavy layers at `'normal'`.
- **Guard every re-apply of a user-adjustable geometry.** `StockChart.jsx:9758-9770` gates
  `setStretchFactor` behind `lastAppliedVolPctRef.current !== pct` so a data poll cannot undo a user's
  pane drag — and it addresses panes through **their series' own `getPane()`**, never a raw index.
  Both rules transfer directly.

---

## 7. WHAT WE ALREADY HAVE vs WHAT IS NEW

Our chart engine already lives at `origin/master:app/src/components/chart/engine/` and is
**already fully on the v5 API, not shimmed v4** `[5A]`. The relevant surface:

| Existing file (`origin/master:app/src/components/chart/engine/…`) | Lines | What it already owns | Reuse for the Pine renderer |
|---|---|---|---|
| **`binder.js`** | 847 | **"THE ONLY FILE IN THE ENGINE THAT TOUCHES LIGHTWEIGHT-CHARTS."** Translates a pure plan into `chart.addSeries(ctor, options, paneIndex)`, `series.moveToPane`, `chart.panes()`, `setStretchFactor`, `series.createPriceLine(spec)` **with handle tracking and removal**, and honours a hard "flag off ⇒ ZERO renderer calls" contract | **REUSE — the biggest head start in the repo.** It is exactly the shape a Pine renderer needs: one seam, all side effects, no policy. Extend it with `attachPrimitive` / `detachPrimitive` and `addCustomSeries`; do **not** start a second renderer seam |
| **`pool.js`** | 777 | Series pooling keyed on series **type** — verified against the installed 5.2.0 bundle that `priceScaleId` is MUTABLE (`applyOptions` → `moveSeriesToScale`), pane is MUTABLE (`moveToPane`), type is IMMUTABLE (`seriesType()` is read-only). Holds `LINE_TYPE {Simple:0, WithSteps:1, Curved:2}`, `lineStyleValue()`, LWC's own colour defaults pinned against the installed package, and `AUTOSCALE_EXCLUDE` / `AUTOSCALE_DEFAULT` as module-level singletons | **REUSE.** The Pine style→series-type map (§2.1 row 1) is the same function `poolKey()` already is, with 11 Pine styles instead of 4 schema styles. `WithSteps` is already wired. The autoscale singletons are already the right two values |
| **`paneLayout.js`** | 991 | The pure vertical geometry: `bands` and `panes` modes from one `stackHundredths` arithmetic; a *total* proof that `scaleMargins` can never go illegal (LWC throws on `top+bottom > 1`, verified at `lightweight-charts.standalone.development.js:4548-4562`), swept over 1,024 configurations × every integer chart height | **REUSE unchanged.** A Pine script's `overlay = false` is a pane request; this file already answers "which pane, how tall" and already cannot produce the illegal-margins throw that cost a fix (`1c1b84bf`, 1,178 illegal layouts, 895 throwing) |
| **`placement.js`** | — | The single authority for "which pane / which price scale / which margins", including `MAIN_PRICE_SCALE_ID`, the full-option-set-every-time rule, and the measured finding that `minimum`/`maximum` are **not** 5.2.0 options | **REUSE.** Pine's `scale.right` / `scale.left` / `scale.none` and `force_overlay` are new inputs to this same function, not a new module |
| **`nativeRegistry.js`, `defSchema.js`, `instances.js`** | — | Definition schema → columns → instances; `defSchema` already knows that `BaselineSeries` fills to a scalar and cannot fill between two plots' per-bar values | **REUSE the shape**; a Pine script is another definition source |
| **6 primitive modules** in `app/src/components/chart/*Primitive.js` | — | **`ISeriesPrimitive` / `IPanePrimitive` in production.** Pane primitives: `watermarkPrimitive` (`'bottom'`, ~200 lines, deliberately hand-rolled *instead of* `createTextWatermark`), `sessionShadingPrimitive` (`'bottom'`). Series primitives on the candle series: `swingLabelsPrimitive` (`'top'`), `levelZonesPrimitive` (`'bottom'`), `prevDayLevelsPrimitive` (`'top'`), `earningsBadgePrimitive` (`'top'`, instantiated 4× with different glyphs) | **REUSE the module shape.** All six share one uniform contract — `{ paneViews, updateAllViews, attached, detached }` with a controller factory exposing `setPoints`/`setOptions` — which is exactly the layer-primitive shape §6.2 prescribes. `sessionShadingPrimitive` is a working `bgcolor`; `levelZonesPrimitive` is a working `box`/band; `swingLabelsPrimitive` is a working `label` |
| `chart/thinVolumeSeries.js` | — | **A working `ICustomSeriesPaneView`** — `priceValueBuilder`, `isWhitespace`, `renderer`, `update`, `defaultOptions`, plus a `ThinVolumeRenderer` with `draw(target, priceConverter)`. Instantiated at `StockChart.jsx:9726` via `chart.addCustomSeries(new ThinVolumeSeries(), volOpts, paneIndex)` | **REUSE as the template** for §6.3's three custom-series candidates. Note the shipped caveat at `:9701`: whitespace forces the built-in path, because the custom renderer does not handle it |
| `ChartCalloutOverlay.jsx` | 459 | A **complete label-placement engine** on a sibling canvas (see §4.2) | **PORT into `LabelLayer`.** The algorithm is done; the host is wrong |
| `ChartDrawingOverlay.jsx`, `ChartVLineOverlay.jsx` | 3,263 / 134 | 22 interactive drawing tools and a 1px date marker, on **separate `<canvas>` elements** (`position:absolute; inset:0; zIndex:4`, no `lightweight-charts` import, `attachPrimitive` count 0) | **MIGRATE, do not extend.** A sibling canvas sits outside the library's z-order and hit-testing. But **take `toPixel` (`:1179-1237`) verbatim** — it is the null / non-integer-logical fallback cascade of R3, plus a `snapVertRef` bypass that computes Y arithmetically when `priceToCoordinate` is a frame stale |
| `StockChart.jsx` | 16,160 | `createSeriesMarkers` (1 controller, reused via `setMarkers`, dynamically imported), `setStretchFactor` (12), `panes()` (7), `autoscaleInfoProvider` (12), `createPriceLine` (6), `attachPrimitive` (10), `addCustomSeries` (1), and `buildFutureWhitespace(lastLwcTime, tf, minCount, targetSlot)` feeding a hidden whitespace `LineSeries` at `:6288` | **REUSE `buildFutureWhitespace` verbatim** — it is R4's mechanism, already holiday-aware |

### 7.1 Build-vs-reuse, per renderer component

| Component | Status | Note |
|---|---|---|
| Series creation, pooling, pane assignment, price scales, margins | ✅ **HAVE** | `binder.js` + `pool.js` + `paneLayout.js` + `placement.js` |
| `hline` via `createPriceLine`, with handle tracking | ✅ **HAVE** | 6 call sites; handles tracked in ref arrays. Includes the measured "always name `lineStyle`, the default is Dashed" lesson |
| `plot` styles line / area / baseline / columns | ✅ **HAVE** | 4 series types wired |
| `plot.style_stepline` → `lineType: WithSteps` | ✅ **HAVE, in the engine only** | `pool.js` sets `base.lineType = lineTypeValue(plot.style === 'stepline' ? 'WithSteps' : 'Simple', c.LineType)`. `StockChart.jsx` itself uses only `Curved`/`Simple` — so `WithSteps` is wired but **has not yet rendered a pixel in the shipped path**. Verify it once |
| `autoscaleInfoProvider` exclude/default | ✅ **HAVE** | frozen singletons in `pool.js`; 12 further installs in `StockChart.jsx`, all calling `baseImplementation()` as the fallthrough |
| **`_padVert` — baking `scaleMargins` into an explicit `priceRange`** | ✅ **HAVE** | R6b. Nothing else in the ecosystem knows this; reuse it |
| Future-bar whitespace anchoring, holiday-aware | ✅ **HAVE** | `buildFutureWhitespace` + a dedicated hidden `LineSeries` on `priceScaleId: ''` |
| Overlay price scales | ✅ **HAVE** | `''`, `'compare'`, and **one scale id per indicator (`def.id`)** — `pool.js:518` **always resolves** `priceScaleId`, never omits it (*"that is the #2049 escape"*) |
| **`attachPrimitive` — series AND pane** | ✅ **HAVE** | 10 sites, 6 modules, both kinds, `'top'` and `'bottom'` both exercised |
| **`addCustomSeries` / `ICustomSeriesPaneView`** | ✅ **HAVE** | 1 (`ThinVolumeSeries`) |
| Markers (4 shapes, 6 positions) | ✅ **HAVE** | covers the `plotshape` subset only. `id` → `hoveredObjectId` is the shipped click gate |
| **Label de-overlap placement pass** | ✅ **HAVE (as a sibling canvas)** | `ChartCalloutOverlay.jsx` — the full engine; `swingLabelsPrimitive` — the cheap skip-on-collide policy. **This is no longer the largest missing piece.** It needs porting, not designing |
| `detachPrimitive` | ❌ **NEW** | 0 production uses — primitives are attached once behind a `…AttachedRef` latch and emptied with `setPoints([])`. A Pine script that is *removed* must genuinely detach; build and test that path |
| **`hitTest` + `externalId` + `PrimitiveHoveredItem`** | ❌ **NEW** | 0 uses. Our badges hit-test with a **manual rect cache** (`earningsBadgePrimitive.js:140-147`) read from `subscribeClick`'s `param.point`. Pine label/box/line tooltips and hover need the real thing, with correct `zOrder` and `hitTestPriority` (R14) |
| **`hoveredInfo` (5.2.0)** | ❌ **NEW** | 0 uses anywhere in `app/src`; we still read the `@deprecated` `hoveredObjectId`. Migrate — `hoveredInfo` is the only field that reports `sourceKind` / `objectKind` / `paneIndex`. Note `hoveredSeriesOnTop: false` is set at `StockChart.jsx:8613` and affects arbitration |
| **`priceAxisViews` / `timeAxisViews`** | ❌ **NEW** | 0 uses — and this is the **only free de-overlap in the library** (§4.2). Use it for any axis label a Pine level wants |
| `addPane` / `removePane` / `swapPanes` / `setHeight` / `preserveEmptyPane` | ❌ **NEW** | 0 uses. Panes are created **implicitly by `addSeries(def, opts, paneIndex)`**, sized only by `setStretchFactor`. (This contests `[5A]`'s aggregate "`addPane`/`setStretchFactor`/`moveToPane` appear 19×" — `addPane` itself is never called.) A Pine script asking for its own pane may need `addPane(true)` + `preserveEmptyPane` so an empty pane survives, and `removePane` on teardown |
| The 7–8 layer primitives (Bg, Fill, Linefill, Line, Box, Label, Shape, Polyline) | ❌ **NEW** | the bulk of the work — but on a proven module shape, with two of them (`sessionShading`, `levelZones`) already existing as narrow special cases |
| Text stack: font, metrics cache, `yMidCorrection`, multi-line, **word wrap**, pill | ❌ **NEW** | vendor 5 files from LWC's `src/` (Apache-2.0) — see §4.1. We have `measureText`/`fillText` and font strings in 4 files already, but no metrics cache and no wrapping beyond `ChartCalloutOverlay`'s two-line `splitTwo` |
| DOM table overlay + per-cell tooltips | ❌ **NEW** | but the DOM-overlay pattern is **already formalized**: `overlayWrapStyle(extra)` / `indexOverlayWrapStyle` at `StockChart.jsx:2355-2368`, used by 5 wrappers at `zIndex: 4`. `createPortal` is already in use for menus |
| Vendored toolkit (`positionsBox`, `positionsLine`, `fullBarWidth`, `PluginBase`, `ClosestTimeIndexFinder`, `UpperLowerInRange`) | ❌ **NEW** | `@tradingview/lwc-toolkit` is **not published on npm** (`{"error":"Not found"}`) — a pnpm workspace package, so **vendor the source**. Legal under Apache-2.0; retain the LICENSE + NOTICE and state that files changed `[5B]` §12 |
| Drag / interactive editing of drawings | ➖ **NOT NEEDED** | there is no primitive drag API, but Pine drawings are script-generated, not user-dragged. Excluded deliberately (`ChartDrawingOverlay` covers *user* drawing on its own canvas) |

**The corrected headline for §7: the plugin layer is NOT greenfield.** An earlier reading of the
engine files alone suggested we had never touched `attachPrimitive` — that was wrong, and it was
wrong because the primitives live in `app/src/components/chart/*Primitive.js`, outside
`engine/`, and are attached from `StockChart.jsx`, not from `binder.js`. **The engine's one-seam
rule and the primitive modules are currently two separate renderer seams**, which is the first thing
a Pine renderer should reconcile: `binder.js` should own `attachPrimitive`/`detachPrimitive` the way
it already owns `addSeries` and `createPriceLine`, or the "flag off ⇒ ZERO renderer calls" contract
cannot cover the drawing layers.

**Prior art, for calibration:** `[5-prior-art]` found exactly one existing "Pine output rendered on
a real chart" implementation — `@luxalgo/vela-pinets` — and it is **AGPL-3.0**, so it cannot be
vendored into a commercial product. `marketcalls/openalgo-pinets` (Lightweight Charts + PineTS) is
AGPL and a one-day demo. **There is no permissively-licensed Pine→LWC renderer to copy.** This map
is the design, not a port.

---

## 8. HONEST GAP LIST

**The list is not empty — but it contains no Pine drawing primitive.** Every Pine visual object in
the demand survey is reachable. What remains splits cleanly into two classes, and only one of them
is LWC's fault.

### Class A — TradingView behaviours nobody has specified (a SPEC gap, not a renderer gap)

These cannot be matched exactly because the target is undocumented. Each needs either an empirical
reverse-engineering pass against the real product, or an explicit "not parity" flag.

| # | Undocumented behaviour | Evidence |
|---|---|---|
| A1 | **`polyline.new(curved = true)`'s interpolation family.** Documented only as *piecewise*, *interpolating* (passes through every point) and *overshooting*. That signature fits several non-monotone cubics; TradingView never names which | `[4D]` §3.3 — *"Marked UNVERIFIED — do not assert Catmull-Rom"* |
| A2 | **`plotarrow`'s length normalisation.** The mapping of `\|value\|` into `[minheight, maxheight]` pixels: denominator (whole dataset? visible range? a window?), linearity, and the all-equal-values case are all unstated. The **vertical anchor** is also unstated | `[4A]` §4.1 — *"the single largest renderer-facing gap in the plot family"* |
| A3 | **`size.auto`'s actual rule** for `plotshape`/`plotchar`/`label`/`box` | `[4A]` §9.5 — the published int equivalents are *"explicitly for tables/boxes/labels, not for plotshape/plotchar"* |
| A4 | **The pixel geometry, anchor point and with-text variant of each of the 12 `shape.*` glyphs.** The doc's table cells are images with no alt text, so no textual description exists | `[4A]` §2.4 |
| A5 | **Whether a `box`'s `bgcolor` fill extends with `extend.left/right/both`** (the horizontal borders demonstrably do) | `[4D]` §1.2 |
| A6 | **Whether `polyline` `fill_color` requires `closed = true`**, and the winding rule for self-intersecting paths | `[4D]` §3.4 |
| A7 | **`table.cell_set_*` on a cell never passed to `table.cell()`** — create-with-defaults, or no-op? (`merge_cells` explicitly *does* work on undefined cells) | `[4E]` §1.9(d) |
| A8 | **Max rows/columns/cells per table.** Documented only as device-dependent | `[4E]` §1.9(a) — UNDOCUMENTED |
| A9 | **Multi-codepoint graphemes in `plotchar(char=)`** (flag emoji, ZWJ sequences, `"AB"`) — compile error, runtime error, truncation, or rendered whole? Only "1 codepoint works, incl. non-BMP" and `""` are certain | `[4A]` §3.1 |
| A10 | **Whether the status line / Data Window report a plot's value at the pointer's bar or at the pointer's bar shifted by `offset`** | `[4A]` §1.3 |

### Class B — real LWC v5 ceilings that no plugin can lift

Exactly two, both in the price-scale model, and both structural rather than accidental.

| # | LWC ceiling | Verbatim basis | Does Pine hit it? |
|---|---|---|---|
| **B1** | **An overlay price scale cannot be pinned to a fixed range.** *"Note that overlay price scales are always auto-scaled."* An RSI overlaid on price cannot be hard-pinned to 0–100 on an overlay id. `PriceScaleOptions.autoScale` is *"Ignored by overlay price scales"*, and `minimum`/`maximum` are not options at all (measured in our own tests) | `[5A]` §2.5; `[REPO]` `placement.js` | **Only in an unusual configuration.** Pine's own model puts an independently-scaled script in its own pane (`overlay = false`), which LWC panes serve natively with a real, pinnable, visible scale. The hit case is `overlay = true` + `scale.none` + a script that needs a *fixed* range on the price pane |
| **B2** | **At most TWO visible price scales per pane.** `'right'` and `'left'` are the only visible slots; every other `priceScaleId` creates an overlay scale that is *"hidden in the UI"* and force-autoscaled | `[5A]` §2.5 | **Only with ≥3 overlaid scripts each wanting its own visible, labelled axis in one pane.** Same escape: give them panes |

A fork of Lightweight Charts is the only thing that would lift B1 and B2. **Neither is worth a
fork**, because the escape in both cases is the mechanism Pine itself specifies.

### What the "no gaps in the drawing layer" conclusion rests on

Stated plainly so it can be attacked:

1. **`ISeriesPrimitive` is a type alias whose every member is optional**, and
   `IPrimitivePaneRenderer.draw(target: CanvasRenderingTarget2D, utils?: DrawingUtils)` hands you a
   raw `CanvasRenderingContext2D` in a choice of two coordinate spaces. Therefore **anything
   drawable in Canvas2D is drawable** — which covers every Pine drawing object, every glyph, every
   fill, every curve, arbitrary line widths, arbitrary fonts. `[5A]` §2.10, `[5B]` §2, §4
2. **Autoscale participation is available** (`autoscaleInfo` on series primitives,
   `priceValueBuilder` on custom series), so drawings can be kept in view. `[5B]` §8
3. **Hover and click are native** via `hitTest` → `MouseEventParams.hoveredInfo.objectId` (5.2.0).
   Drag is DIY, and Pine does not need it. `[5B]` §6
4. **Coordinates beyond the data range resolve correctly** via integer logical indices, and future
   slots can be *materialised* with whitespace — already proven in our own production code. `[5A]`
   §2.8
5. **Tables have two viable homes** (`'top'` pane primitive, or DOM overlay), and the DOM route is
   the one the library's own examples take for text-heavy overlays. `[5B]` §11(c)
6. **`[5B]` tested six hard Pine visuals explicitly** — series-varying filled band, 500 boxes,
   60-cell fixed table, curved polyline, non-overlapping bar labels, thousands-of-cells heatmap —
   and returned *"No fork is required for any of the six."* The gaps it found are all of the form
   *"the API lets you, the library helps you with none of it"*: text layout, label collision,
   viewport culling for primitives, and drag.

### One listed gap I contest

`[5A]` §2.11 lists *"`plot()` with per-point line width or per-point line style"* as a native gap
versus Pine. **It is not a Pine requirement.** Pine's `plot()` declares `linewidth` as `input int`
and `linestyle` as `input plot_line_style` `[4A]` §1 — neither accepts `series`, so *"because
`linewidth` is `input int` the width cannot vary bar to bar"* is Pine's own rule, not a limitation
we must overcome. LWC's series-level `lineWidth` / `lineStyle` therefore match Pine exactly for
`plot()`. (The genuinely `series`-qualified widths and styles are on `line.new` and `box.new`, and
those are drawn by our own primitives, where nothing is capped.) **This saves the N-series-per-plot
workaround the gap list implies.**

---

## 9. THE ONE-PAGE SUMMARY

1. **5.2.0, pinned exactly on `origin/master`.** No upgrade needed; 5.2.1's plugin typings are
   identical. **No fork needed.**
2. **Seven or eight layer primitives** — `Bg`, `Fill`, `Linefill`, `Line`, `Box`, `Label`, `Shape`,
   `Polyline` — carry the entire Pine drawing surface. **One primitive per object CLASS, never per
   object.**
3. **Five Pine primitives are natively expressible** (`plot`, `barcolor`, `hline`, `plotcandle`,
   `plotbar`); markers cover a *subset* of `plotshape`; tables are DOM; nothing *requires* a custom
   series and three things *want* one.
4. **Pine's 9 buckets land on 6 real LWC positions**, with buckets 5–8 emulated by **attach order**
   in the `'normal'` + `draw()` slot. Attach `Linefill → Line → Box → Label`, in that order, to
   **one** host series. Only `fill()` goes in `drawBackground`; linefills and box fills do **not**.
5. **Tables must be `'top'` or DOM**, because a pane primitive always paints beneath a series
   primitive — and that is precisely what enforces Pine's "a plot can never sit above a table".
6. **The four hazards that will cost a day each:** `logicalToCoordinate(non-integer) === 0`;
   `logicalToCoordinate` also returns `null` beyond the extrapolatable right-pad on intraday (R3,
   measured in our own code); primitive `autoscaleInfo` never runs on a data-less host (whitespace
   does not count); `AutoscaleInfo.margins` is overwritten, not merged — and an explicit
   `priceRange` is used **edge-to-edge**, ignoring `scaleMargins` entirely (R6b).
7. **Label de-overlap is the largest piece LWC does not give you — but we already built it.**
   `ChartCalloutOverlay.jsx` is a complete measure → search → cache → collide placer;
   `swingLabelsPrimitive` is the cheap skip-on-collide policy. **Port, don't design.**
8. **`binder.js` is the head start — and there are currently TWO renderer seams, not one.**
   `binder.js` owns `addSeries` / `moveToPane` / `createPriceLine` behind a hard "flag off ⇒ zero
   calls" contract; the 6 primitive modules are attached from `StockChart.jsx` instead. Reconcile
   that first, or the Pine drawing layers sit outside the engine's safety contract.
9. **What is genuinely new, in order of risk:** `hitTest` + `externalId` (we have never used it),
   `hoveredInfo` (we still read the deprecated `hoveredObjectId`), `detachPrimitive` (never used),
   `priceAxisViews` (never used, and it is the only free de-overlap in the library), real word
   wrapping, a text-metrics cache, and `addPane` / `preserveEmptyPane` / `removePane` (panes are
   currently created implicitly by `addSeries`'s third argument).
