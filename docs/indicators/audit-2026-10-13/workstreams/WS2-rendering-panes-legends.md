# WS2 — Indicator rendering, panes and legends (evidence appendix)

Audit worktree `C:/w/indaud`, branch `audit/indicators-competitive-2026-10-13` = `origin/master` = production `84164aee3d` (2026-10-13). This was an audit only: no runtime code, tests or config were changed. The scratch probes live under `app/src/__audit_scratch__/ws2/` and are not committed.

**Method.** For each visual capability I traced its path: schema (`defSchema.js` / Pine translator) → computed column → renderer call (lightweight-charts 5.2.0 series, or a custom primitive / DOM layer). Docs and comments were treated as leads only. Every claim below is cited to code, and where it mattered it was checked with a scratch probe against the real modules.

**The renderer in one paragraph.** `pool.planBindings` → `pool.poolKey(plot)` picks one LWC series type per output: `line`, `histogram`, `columns` (custom `thinVolumeSeries`), `area`, `baseline`, `candlestick` or `bar` (`pool.js:118-153`). `pool.seriesOptionsForPlot` builds that series' options (`pool.js:586-720`), and `binder.toPoints` writes the `{time, value, color?}` points for it (`binder.js:304-319`). Everything else is attached on top of that:
- Guides: `createPriceLine` (`binder.js:2147-2157`, `guideSpecs` at `binder.js:591-603`).
- Fills: the custom `fillPrimitive`, attached to the binding's series (`binder.js:2159-2219`).
- Markers: LWC `createSeriesMarkers` (`binder.js:2321-2357`).
- `bgcolor`: `paintPrimitive.createBackgroundPrimitive`.
- `barcolor`: a host candle-series wrapper (`barColours.js`; `binder.js:826-939`).
- Pine objects (line, label, box, linefill): one absolutely positioned **DOM canvas** over the whole chart container (`objectLayer.js`, painted by `objectCanvas.paintObjects`).
- Tables: a sibling **DOM `<table>`** layer (`objectTableDom.js`).

---

## 1. Capability matrix

Status key: **Works**, **Limited** (works with material restrictions), **Partial** (some paths render and others do not), **Not rendered** (the language or UI accepts it and the renderer draws nothing, or draws something else), **Absent** (neither side has it).

| Capability | Schema / language support | Renderer support | Properties | Tests | Status | Evidence |
|---|---|---|---|---|---|---|
| Line, multiple lines | `PLOT_STYLES` line; one plot per output; Pine `plot()` | LWC `LineSeries`, one binding per plot | color, width, lineStyle, lineType (curved), precision, opacity, lastValueVisible, autoscale, displace | `pool.test.js`, `binder.test.js` | Works | `pool.js:118-123,697-720`; `defSchema.js:156-158` |
| Step line | `stepline`; Pine `style_stepline` | LineSeries `lineType: WithSteps` | as line | `pool.test.js` | Works | `pool.js:702-703`; `pine.js:25655` |
| Line with breaks (`style_linebr`) | Pine `style_linebr` → `'line'` | LWC 5.2 **connects across whitespace**. A break is drawn only when `sparse:true` or there is PIT lineage, and the translator never sets `sparse`. | — | none for Pine linebr | **Not rendered** (bridged) | `pine.js:25654`; `gapRuns.js:1-25` (measured: "a line series KEEPS ONLY VALUED ROWS … and connects them"); `binder.js:2372-2373`; probe P-D (`presentation:{style:'line'}`, no note) |
| Histogram | `histogram`; Pine `style_histogram`, `style_columns` | `HistogramSeries` (or `columns` when `bar` geometry is set) | color, sign colours, per-point column colours, precision, bar width/offset (`columns`) | `signedHistogram.test.js`, `pool.test.js` | Works | `pool.js:130-131,679-690` |
| Histogram base (`histbase`) | Not in schema; Pine `histbase` not carried | always 0 (`histogramBaseline` exported but **no consumer**) | — | — | Absent | `presentation.js:588`; grep: no caller |
| Columns (side by side) | `histogram` + `plots[].bar` / `presentation.bar` | custom `ThinVolumeSeries` | widthRatio, offsetRatio | `pool.test.js` | Works | `pool.js:673-677` |
| Area | `area`; Pine `style_area`, `style_areabr` | `AreaSeries` (lineColor, topColor at alpha, bottom 0) | color, opacity, width | `pool.test.js` | Works (static colour) | `pool.js:709-716` |
| Area with per-bar / conditional colour | Schema accepts `colorMode: column:<k>`/`sign` on an area plot (probe P-B2: `ok=true`). A member can re-style a sign-coloured histogram to Area. | `toPoints` writes `point.color`. **LWC `AreaData` has no `color`** (only lineColor/topColor/bottomColor, `typings.d.ts:411-424`), so the colour is dropped. | — | none | **Not rendered** | `binder.js:304-319`; `pool.js:709-716`; probe P-B |
| Baseline | `baseline` (author only) | `BaselineSeries`, LWC default colours, `topLineColor` = plot colour | color only; **no baseValue** field | `pool.test.js` | Limited | `pool.js:290-301,718-723` |
| Dots / circles | `markers`; Pine `style_circles`; user "Dots" | LineSeries `lineWidth:0` + `pointMarkersVisible` | dot size (S/M/L) | `pool.test.js` | Works | `pool.js:697-707`; `presentation.js:308-322` |
| Cross style (`style_cross`) | `cross` reserved, refused | — | — | `defSchema.test.js` | Absent (disclosed as uncarried) | `defSchema.js:231`; `pine.js:25581-25587` |
| Event markers / shapes (`plotshape`, `plotchar`) | `plots[].marker` {shape ∈ circle/square/arrowUp/arrowDown; position ∈ above/below/inBar; size 0.25-4; static text ≤24} | LWC `createSeriesMarkers`. Above/below on pane 0 ride the candle series. **The plot's own 0/1 LineSeries is also drawn with visible point markers** (see G3). | shape, position, size, text, colour (fixed or two-tone) | `markerPrimitive.test.js`, `markerHost.test.js` | **Limited**: 8 of 12 Pine shapes approximated; `location.top`/`bottom` approximated; plotchar glyph drawn as circle + text; spurious dots | `defSchema.js:179-183`; `pine.js:25606-25640`; `markerPrimitive.js`; probe ws2MarkerDots |
| Marker conditional colour | `colorMode: column` with up/down | two-tone only. **Palette, gradient and packed colours are ignored** (flat plot colour). | — | `markerPrimitive.test.js` (two-tone) | Partial | `markerPrimitive.js` (`twoTone` only); probe P-C |
| Arrows (`plotarrow`) | Pine `plotarrow` is a single series | rendered as a column (no arrow glyph renderer found) | — | — | Limited (not verified visually) | `pine.js:542-552` |
| Labels / text (Pine `label.new`) | runtime object store + host object program | objectCanvas text, label styles mapped to anchors (an unknown style draws a plain box) | text, textcolor, size, textalign, style, bg colour | `objectCanvas*.test.js`, `objectLayer.test.js` | Works on the price pane; see G1 for other panes | `objectCanvas.js:38-60,375-395` |
| Horizontal levels (`hlines`, Pine `hline`) | `hlines` + `levels[]`, colour, width, lineStyle (incl. largeDashed) | `createPriceLine` on the first visible binding, `axisLabelVisible:false` | levels, color, width, lineStyle | `binder.test.js`, `evaluability.levelLines.test.js` | Works | `binder.js:591-603,2147-2157`; `defSchema.js:369` |
| hline↔hline fill (e.g. the RSI 30/70 band) | Pine `fill(h1, h2)` | **Not drawn**. Disclosed: "`fill` is not drawn: its two edges are not both plots". | — | `chartOnly.test.js` | Not rendered (disclosed) | `pine.js:13978` |
| Dynamic per-bar line colour | `colorMode: sign` or `column:<k>` + up/down / palette / gradient / packed | LWC Line and Histogram per-point `color` | as listed | `dynamicColourColumn.test.js`, `paletteColourColumn.test.js` | Works (line, histogram, dots) | `pool.js:806-822`; `binder.js:304-345` |
| Conditional candle colour (`barcolor`) | `def.paints[]` kind `barcolor` | host candle-series wrapper recolours body, border and wick. The later script or instance wins. | colorMode column, static, offset, showLast | `paintRender.test.js`, `paintsDoor.test.js` | Works (OHLC chart types only) | `barColours.js` (`applyBarColour` skips `bar.open == null` and pre-coloured bars); `binder.js:888-899` |
| Background colour (`bgcolor`) | `paints[]` kind `bgcolor` | `createBackgroundPrimitive` (zOrder bottom, full pane height) on the instance's pane. A pane script with *only* a bgcolor is refused by name. | colour, colorMode, offset, showLast | `paintRender.test.js` | Works | `paintPrimitive.js`; `binder.js:864-887`; `memberPaneDefinition.js:261-273` |
| Fill between plots | `plots[].fill.with` (plot↔plot) | `fillPrimitive` polygon runs, gaps never bridged, a hidden plot can host a fill | colour, opacity, per-bar colours (column/palette/gradient/packed) | `fillPrimitive.test.js`, `fillBinding.test.js`, `fillColourRuns.test.js`, `hiddenAnchorFill.test.js` | Works | `fillPrimitive.js:45-200`; `binder.js:2159-2219` |
| Conditional fill | same `colorMode` on the fill spec | runs split on colour change; `null` → gap | — | `fillColourRuns.test.js` | Works | `fillPrimitive.js:45-80` |
| Band style | `band` + `edges` | drawn as a centre **line**. `fill` is reserved, so the band has no fill unless `plots[].fill` is declared. | — | `pool.test.js` | Limited | `pool.js:84-96` |
| Boxes / rectangles | Pine `box.new` | objectCanvas: bgcolor, border colour/width/style, extend, text with halign/valign/size | listed | `objectCanvasVisuals.test.js` | Works on the price pane (G1) | `objectCanvas.js:268-310` |
| Lines (Pine `line.new`) | runtime + host lanes | objectCanvas: extend, dash styles, arrow styles | colour, width, style, extend | `objectCanvas.test.js` | Works on the price pane (G1) | `objectCanvas.js:320-360` |
| Linefill | `linefill.new` | objectCanvas | colour | `objectCanvas.test.js` | Works on the price pane (G1) | `runtime/objectStore.js:39` |
| Polylines | `polyline.new` | **Refused by name** (`OBJECT_REFUSED`) | — | — | Absent (disclosed) | `runtime/objectStore.js:36-39` |
| Tables | `table.new` / `table.cell` / `merge_cells` / `clear` | DOM `<table>`, 9 anchors, colspan/rowspan, frame and border, text_size/colour/halign/valign/formatting/bgcolor; phone fit; stays in its own pane | as listed. **Not carried:** cell `width`/`height`, `tooltip`, `text_font_family` | `objectTableDom.test.js`, `tableMergeCells.test.js`, `tableTextFormatting.test.js`, `objectTableStack.test.js`, `paneTablesFit.test.jsx`, `pineTableVendorParity.test.js` | Works (minor props missing) | `objectTableDom.js:150-235` (cell props read: text, bgcolor, text_formatting, colspan, rowspan, text_valign, text_halign, text_color, text_size, covered) |
| Last value on the price scale | `plots[].lastValueVisible`; ctx `lastValue` | LWC `lastValueVisible`; `priceLineVisible` is always false | boolean | `pool.test.js` | Works | `pool.js:597-613` |
| "Last value horizontal" plot style | Offered in the Plot Style dropdown (`PLOT_STYLE_CHOICES`) | **Maps to `line` and draws the full history line**. `drawsHistory` has no consumer. The authors' own commit note says it "is a style its binder does not know". | — | none render it | **Not rendered (UI presents it)** | `presentation.js:32-48,72,104,233`; `ChartSettingsIndicators.jsx:2719-2740`; commit `d6f9c8861b`; probe ws2LastValueH (options byte-identical to Line) |
| Custom precision / format | `plots[].precision` (axis), `legend.decimals`, `legend.compact` | `priceFormat.precision`; chip decimals and compact formatting | — | `readout.test.js` | Works for natives. **Pine `format=`/`precision=`/`scale=` not carried** (disclosed); Pine plots get `decimals:2` | `pool.js:350-352`; `readout.js:190`; `pine.js:27724`; `BuilderSheet.jsx:401` |
| Visibility toggles | instance `hidden`, timeframe `visibility`, global hide (Alt+Shift+I), author `plots[].hidden` | instance and timeframe hide drop bindings, objects and paints. **Global hide flips series `visible` only** (G4). **No per-output user hide.** | — | `instanceControls.test.js`, `eligibility.test.js`, `chipMenu.test.js` | Partial | `StockChart.jsx:16029-16065`; `binder.js:837,974-1158` |
| Plot ordering / z-order | `zorder.js` (Pine's 9 buckets) | **`zorder.js` has no runtime consumer** (only its test). Real order: bgcolor and fills at `bottom`, series, price lines, then the objects canvas (DOM z 3) and tables (DOM z 4) above the whole chart. In-pane series order: `paneSeriesOrder` **reorders only the settings list** (`chartDataMap.js:257`); no `setSeriesOrder` is applied from it. | — | `zorder.test.js`, `paneSeriesOrder.test.js` | Partial | `objectLayer.js:72-76,112`; grep `paneSeriesOrder` (renderer: none) |
| Transparency | `plots[].opacity`, `colorGradient.transparency`, `colorPacked.transparency`, rgba/#RRGGBBAA | `withAlpha` folded into colours | — | `pool.test.js` | Works | `pool.js:485-530` |
| Line styles and widths | `PLOT_LINE_STYLES` solid/dashed/dotted/largeDashed; width > 0; user picker solid/dashed/dotted, 1-4 px (instance-level, only where `meta.appearance` declares it) | LWC lineStyle/lineWidth | — | `pool.test.js`, `instanceControls.test.js` | Works | `defSchema.js:369`; `presentation.js:470-500`; `instanceControls.js:994-1030` |
| Offset (user) | `meta.appearance` 'offset' | shown **disabled, "Coming soon"** | — | — | Absent (honestly disclosed) | `ChartSettingsIndicators.jsx:2904-2918`; `instanceControls.js:1018` |
| OHLC outputs (candles / bars, `plotcandle`) | user styles `candles`/`bars`, gated by `ohlcCapability`; Pine `plotcandle` → candles | `CandlestickSeries`/`BarSeries`, up/down colours | upColor, downColor, thinBars | `candlePresentation.test.js`, `ohlcBinding.test.js` | Works (no per-bar plotcandle colour; runtime lane does not draw plotcandle or plotbar — disclosed) | `pool.js:141-149,621-656`; `memberPaneDefinition.js:867-874` |

---

## 2. Pane system findings

- **Ownership and placement.** `placement.resolvePlacement` puts each instance on price, its own pane, volume, or as a guest of another instance's pane (`displayTarget.js`). A price-pane overlay gets `autoscale: 'exclude'` (`placement.js:450`).
- **Reorder.** Panes are reordered with `paneOrder.movePane`/`movePaneTo` (Arrange UI, `ChartSettingsIndicators.jsx:1312-1316`) and realised by `paneRealization`.
- **Resize.** A drag is captured by `sizesFromStretch` → `paneSizes`, keyed by pane key (`StockChart.jsx:16569-16596`). `paneStretchPlan` assigns heights by `layout.panes[i].index` (the slot) and applies `paneSizes` per key (`paneLayout.js:1040-1062`).
  - This means the memory note "budgets do not travel with a moved pane" is **stale for the plan**: the plan is reorder-aware.
- **The height *verifier* is still positional.** `paneHeightMismatch` compares `heights[first+i]` with `layout.panes[i].stretchFactor` and ignores both `.index` and `paneSizes` (`paneLayout.js:1151-1182`). Probe P-A, with the plan applied exactly:
  - reorder → `pane 2 is 132px, expected 70px`;
  - user resize → `pane 2 is 179.1px, expected 70px`;
  - the un-arranged control returns `null`.
  - Effect: a wasted re-apply plus a warning on every reordered or resized chart (`binder.js:1345-1376`). The verifier does not throw, so the picture is right. The diagnostic is wrong (P3).
- **"Above/below price".** It is done through `paneOrder`. `instanceControls.setInstancePanePosition` writes `placement.position`, but **nothing reads it and no UI calls it**. It is a dead writer (P3, cleanup).
- **Volume residency.** The rule "a pane exists if it has a resident plotted series" is implemented by `volumePresentation.nativeVolumeOwnsPane` / `volumePaneRequired` (`volumePresentation.js:125,165`). Tests pass: `volumePaneResidency.test.js`, `volumeGuestScale.test.jsx`.
- **Tables follow their pane.** Tables are inset to the instance's own pane rect and fall back to the price pane when the stack does not fit (`objectLayer.js:172-195`).
- **G1: Pine objects do NOT follow their pane.** Lines, labels, boxes and linefills always use the **candle series** `priceToCoordinate` (`StockChart.jsx:13048,13097`), on a canvas that spans the whole container (`objectLayer.js:75`) and is clipped only to the full container height (`objectCanvas.js:257`). The pane rect is computed but used **only for tables**. No gate refuses objects in a non-overlay script (`paneGate.paneObjectsGate` has no overlay check, `paneGate.js:61-67`). No test covers objects in a non-overlay pane.

## 3. Legend findings

- **Chips.** They are built per instance from `plots[].legend` (`readout.legendChips`, `readout.js:794-870`).
  - A plot with no `legend`, or with `legend.hide`, has no chip. Pine and Builder plots get `legend:{decimals:2}` (`BuilderSheet.jsx:389-401`).
  - Hidden instances keep a chip, so they can be un-hidden.
  - Sparse plots collapse to their valued member.
  - Timeframe-hidden instances (`hiddenBy`) get no chip (`readout.js:839-840`).
- **Chip actions** (`chipMenu.js:142-234`): Hide/Show, Move (Display submenu), Settings, Info-value, Modify with UCT Intelligence, Edit formula, Duplicate, Custom copy, Alerts, About, Remove.
- **Readout.** Values come from crosshair `seriesData` per binding. Fills, markers, bgcolor and objects contribute no readout, which is expected.
- **Chip value colour is static.** It is the plot's declared colour (`resolvePlotColor`), not the bar's dynamic colour (P3).
- **Legend under global hide.** The pane legend is not rendered while global hide is on (`StockChart.jsx:20052`).
- **Pane placement.** Chips are grouped per pane through `paneReadoutPlacement` (tests pass).

---

## 4. Gaps

### G1 — Pine objects in a non-overlay (own-pane) script are drawn in price-pane coordinates. Suggested **P0-candidate / P1**; browser confirmation pending.
- **Description.** `line.new` / `label.new` / `box.new` / `linefill` from a script with `overlay=false` are mapped with the candle series' `priceToCoordinate` over the whole chart canvas. Their Y position is computed on the *price* scale, not the indicator's pane scale.
- **Evidence.** `StockChart.jsx:13048` (`const series = candleSeriesRef.current`) and `:13097` (`priceToY: (p) => series.priceToCoordinate(p)`); `objectLayer.js:236` passes `map.priceToY`; the pane rect is used only for tables (`objectLayer.js:172-195`); the clip is the full container (`objectCanvas.js:257`); `paneGate.js:61-67` has no overlay check.
- **Current vs expected.**
  - Current: an RSI-pane label at 70 is placed where price 70 would be on the candle scale. That is usually off-screen, or over another pane, and it is drawn rather than skipped, because LWC returns a coordinate for any price.
  - Expected: drawn on the instance's own pane scale (TradingView behaviour), or refused by name.
- **User impact.** A whole class of imported oscillator scripts with divergence labels or level boxes shows its drawings in the wrong place or not at all, with no disclosure. This is a silent wrong picture.
- **Complexity.** Medium. The mapping needs the instance's own series (`shown.series.priceToCoordinate`) plus a Y offset and clip to `map.pane`. The data is already computed in the same closure.
- **Dependencies.** Object layer, pane manifest, `force_overlay` semantics (objects with `force_overlay=true` must stay on price).
- **Regression risk.** Medium: price-pane overlays must stay byte-identical.

### G2 — "Last value horizontal" is offered and draws a normal line. Suggested **P0 under the brief's definition** (unsupported behaviour presented as supported); low blast radius.
- **Evidence.** `presentation.js:72,104`; `drawsHistory` (`presentation.js:233`) has no consumer anywhere; `ChartSettingsIndicators.jsx:2719-2740` lists it whenever `availableStyles` includes it (it does, for every scalar source: `sourceCapability.js:38,95`); commit `d6f9c8861b` says it "is a style its binder does not know". Probe: the series options are byte-identical to Line.
- **Current vs expected.** Current: a full history line. Expected: no history, plus a horizontal price line at the last value. Otherwise, remove the option.
- **Impact.** A member chooses it and sees nothing change.
- **Complexity.** Low: remove the choice. Implementing it is low to medium (`lineVisible:false` + a price line, or `createPriceLine` at the last value).
- **Dependencies.** None.
- **Regression risk.** Low.

### G3 — Marker plots (`plotshape`/`plotchar` imports, Builder signal markers) also draw point-marker dots at their 0/1 condition values. Suggested **P1**; browser confirmation pending.
- **Description.** A `markers` plot carrying a `marker` glyph is still bound as a LineSeries with `pointMarkersVisible: true`, `lineWidth: 0` and radius 3, and its data is the 0/1 column.
- **Evidence.** `pool.js:697-707`; `binder.js:1916-1953` (no special case); probe ws2MarkerDots: `pointMarkersVisible=true radius=3`, `setData` values 0/1 for every bar.
- **Current vs expected.**
  - In an oscillator pane: a row of dots at y=0 and y=1 under every bar, and 0..1 enters the pane autoscale, in addition to the glyphs.
  - On the price pane the dots sit at price 0 or 1. That is off-screen, except on sub-$2 symbols. Autoscale is excluded there.
  - Expected: glyphs only.
- **Impact.** Visual noise and distorted pane scales on every imported plotshape script outside the price pane.
- **Complexity.** Low: no point markers (or `visible:false` data carrier) when `plot.marker` is set.
- **Regression risk.** Low to medium: SAR-style "dots" must keep their dots.

### G4 — Global "hide indicators" (Alt+Shift+I) leaves non-series layers drawn. Suggested **P2**; browser confirmation pending.
- **Evidence.**
  - The effect only sets `visible:false` on series (`StockChart.jsx:16029-16065`).
  - LWC 5.2 draws attached primitives regardless of series visibility (`lightweight-charts.development.mjs:9929-9945`, `_drawSources` does not filter by visibility). So `fillPrimitive` stays drawn (it does no visibility check, `fillPrimitive.js:231-245`).
  - Markers attached to the *candle* series stay drawn. The markers plugin checks only its host's visibility (`:15752`).
  - The object/table layers ignore `indicatorsHidden` (`binder.js:974-1158`; only `syncPaints` reads it, `binder.js:837`).
- **Expected.** Everything an indicator draws is hidden.
- **Impact.** A "declutter" that leaves fills, Pine drawings, tables and above/below-bar glyphs behind.
- **Complexity.** Low to medium.
- **Regression risk.** Low.

### G5 — Pine `plot.style_linebr` / `style_areabr` are bridged across `na`. Suggested **P2**.
- **Evidence.** `pine.js:25654,25659` map both to the unbroken style. `sparse` is never set by the translator (grep: only `defSchema.js:1768` and native Supertrend `nativeRegistry.js:1287-1288`). LWC connects valued rows (`gapRuns.js:6-12`). Probe P-D: `presentation:{style:'line'}`, and the only note is `pine:declaration`.
- **Expected.** Breaks at `na`. The fix is cheap: emit `sparse:true` for the `*br` styles, which reuses `gapRuns` splitting.
- **Impact.** Supertrend-style "switching" lines get diagonal connectors where TradingView shows gaps.
- **Regression risk.** Low.

### G6 — Per-bar colour on Area/Baseline is silently dropped. Suggested **P2**.
- **Evidence.** The schema accepts `colorMode` on an area plot (probe P-B2 `ok=true`). `toPoints` emits `color` (`binder.js:304-319`). `AreaData` reads `lineColor`/`topColor`/`bottomColor` only (`typings.d.ts:411-424`). `presentedPlot` keeps `colorMode:'sign'` when a member re-styles a signed histogram to Area (probe).
- **Expected.** Map to `lineColor`/`topColor`, or refuse the combination in `availableStyles`.
- **Impact.** Pine `style_area` with `color = cond ? a : b` draws one colour.
- **Complexity.** Low.
- **Regression risk.** Low.

### G7 — Marker colours ignore palette, gradient and packed colours. Suggested **P2**.
- **Evidence.** `markersFor` handles two-tone only (`markerPrimitive.js`); `columnColorsForPlot` returns `palette`/`gradient`/`packed` with `up=down=null` (`pool.js:806-822`). Probe P-C: all markers flat `#aaaaaa`.
- **Complexity.** Low: reuse `binder.pointColour`.
- **Regression risk.** Low.

### G8 — hline↔hline fills are not drawn (disclosed). Suggested **P2**.
- **Evidence.** `pine.js:13978`.
- **Impact.** The classic RSI/Stoch 30-70 shaded band is missing on imports. It is disclosed in notes, but it is a very common idiom.
- **Complexity.** Medium: a fill against a constant-level column, or a band primitive keyed on the guide levels.

### G9 — In-pane series reorder changes the list, not the drawing. Suggested **P2**.
- **Evidence.** `paneSeriesOrder` is read only by `chartDataMap.js:257`. There is no `setSeriesOrder` from it; `StockChart.jsx:12786-12808` applies z-order only to MA-vs-candle overlap.
- **Expected.** A drag reorders the draw order (TradingView "Visual order"), or the control is described as list order.
- **Complexity.** Low to medium (`series.setSeriesOrder`).
- **Regression risk.** Low.

### G10 — Z-order contract module is unconsumed. Suggested **P3**.
- **Evidence.** `zorder.js` is imported only by `zorder.test.js` and `screener/reachable.test.js`. The same is true of `textLayout.js` (no non-test importer). Actual layering is fixed by DOM z-index (canvas 3, tables 4; `objectLayer.js:76,112`). That puts Pine drawings above every pane's series and the crosshair, and above other panes when mis-mapped (G1).
- **Impact.** Documentation and tests describe an ordering mechanism the renderer does not use. `explicit_plot_zorder` and `behind_chart` cannot be expressed.

### G11 — Pane height verifier ignores reorder and resize. Suggested **P3**.
- **Evidence.** Section 2 and probe P-A.
- **Impact.** False warnings, plus one redundant `setStretchFactor` pass per mismatch. The picture is unaffected.
- **Complexity.** Low: verify `heights[panes[i].index]` against the planned value after `applyPaneSizes`.

### G12 — Smaller gaps. Suggested **P3**.
- No per-output user hide (TradingView's per-plot checkbox). Visibility is per instance only.
- No per-output colour override unless the definition declares a colour input.
- Pine `format=`/`precision=`/`scale=`/`show_last`/`trackprice` not carried (disclosed, `pine.js:27724-27725`).
- `histbase` absent.
- Baseline has no `baseValue`.
- Table cell `width`/`height`/`tooltip` not carried.
- Chip value colour is static.
- `setInstancePanePosition` is a dead writer.
- Pine `plotchar` draws a circle + text rather than the glyph.
- `location.top`/`bottom` approximated.
- 8 of 12 `shape.*` approximated (the `approx` flag is disclosed).

---

## 5. Tests run (all targeted; all green)

| Batch | Files | Result |
|---|---|---|
| 1 core rendering | `pool.test.js`, `binder.test.js`, `readout.test.js`, `placement.test.js`, `paneLayout.test.js`, `signedHistogram.test.js`, `instanceControls.test.js`, `__tests__/{fillPrimitive,fillBinding,fillColourRuns,paintRender,markerPrimitive,markerHost,zorder}.test.js` | 14 files, **492 passed** |
| 2 objects, tables, panes | `__tests__/{objectCanvas,objectCanvasClip,objectCanvasVisuals,objectLayer,objectTableDom,objectTableStack,tableMergeCells,tableTextFormatting,objectDoorDraws,objectRenderState,binderObjectRangeRepaint,paneOrder,paneOrderLayout,paneSeriesOrder,paneSizes,paneSizeKeyIdentity,paneSizeOwnership,paneRealization,paneSeparatorPin,paneStability,paneMatrix8State,volumePaneResidency,volumeNumericPane,emptyPaneReclaim}.test.js` | 24 files, **325 passed** |
| 3 legend, colour, pane UI | `__tests__/{legendFromDefinitions,legendModes,everyIndicatorHasALegendDoor,sparseLegend,readoutSiblingChips,paneReadoutPlacement,candlePresentation,ohlcBinding,dynamicColourColumn,paletteColourColumn,presentationColourSinks,sourcePresentation,plotDisplacement,hiddenAnchorFill,hostlessFillNotes,autoscaleOnARealScale,priceDrawableArea,instanceHostedPanes}`, `legend/{IndicatorChip,IndicatorChip.empty,LegendRow,chipMenu,chipMenu.infoValue}`, `pane/ChartPane.test.jsx` | 24 files, **410 passed** |
| 4 schema, tables, settings | `eligibility.test.js`, `defSchema.test.js`, `__tests__/{volumeGuestScale,paneReadoutPlacement.stockchart,paneTablesFit,memberPaneTables,pineTableVendorParity,tableCellSetters}`, `ChartSettingsModal.indicators.test.jsx`, `ChartToolbar.legend.test.jsx`, `memberPane/{paintsDoor,objectsOnlyPane}.test.js` | 12 files, **298 passed** |
| Scratch probes (uncommitted) | `__audit_scratch__/ws2/{ws2Probes,ws2Probe2,ws2MarkerDots,ws2LastValueH}.test.js` | 11 probes, all executed. They confirm G2, G3, G5, G6, G7 and G11. |

Total: 74 existing files, 1,525 tests, 0 failures. **Coverage holes:** no test covers objects in a non-overlay pane (G1), marker-plot point-marker suppression (G3), global hide versus primitives and objects (G4), `style_linebr` breaks (G5), area with per-point colour (G6), or `lastValueHorizontal` rendering (G2). The suites are fake-chart and unit level; LWC pixel behaviour is asserted only through the parity harness, which is not run here.

---

## 6. Browser checks for the lead (riskiest claims)

1. **G1.** Import a non-overlay Pine script that does `if ta.crossover(rsi,70)` → `label.new(bar_index, 70, "x")` and `line.new(bar_index-10, 30, bar_index, 30)`. Check whether the label and line sit inside the RSI pane at 70/30, or land on or under the price pane, or not at all. Read `data-uct-objects-drawn`, `-skipped` and `-bbox` on `canvas[data-uct-object-layer]`.
2. **G3.** Import an `overlay=false` script with `plot(ta.rsi(close,14))` + `plotshape(ta.crossover(...), location=location.abovebar, style=shape.triangleup)`. Look for a row of small dots at 0 and 1 across the pane, and for whether the RSI pane's axis now spans down to 0.
3. **G3, price variant.** The same plotshape with `overlay=true` on a sub-$2 ticker. Look for dots at price 0/1.
4. **G2.** On any RSI, Settings → Plot style → "Last value horizontal". Expect no visible change (a full line).
5. **G4.** Add Bollinger (with fill), a Pine script with a table plus a label, and a Builder signal with above-bar markers. Press Alt+Shift+I. Check whether the fill band, table, label and markers are still visible.
6. **G5.** Import a Supertrend-style `plot(dir<0 ? st : na, style=plot.style_linebr)`. Look for diagonal bridges at trend flips.
7. **G6.** Set MACD histogram to sign colours, then Plot style → Area. Expect a single-colour area. Separately, import `plot(x, style=plot.style_area, color = x>0 ? color.green : color.red)`.
8. **G8.** Import an RSI with `h1=hline(70)`, `h2=hline(30)`, `fill(h1,h2)`. Confirm there is no shaded band and that the disclosure sentence is visible.
9. **G9.** In Chart Data, drag two overlapping series in one pane into a new order. Check whether the draw order (which line is on top) changes.
10. **G11 / pane resizing.** Reorder panes (Volume above Price), then drag a pane divider and reload. Confirm the heights persist per pane, and look for `paneLayout: pane N is …px, expected …px` in the console.
11. **Tables across panes.** A calculator-table script in its own short pane: the table should fall back to the price pane, not be clipped. Then resize that pane taller: the table should move into it.
12. **Barcolor on a non-candle chart type.** A Pine `barcolor(close>open ? color.blue : color.orange)` on Candles, then switch the chart type to Line or Area. Confirm colours apply on Candles/Bars and are silently absent on Line/Area. That absence is expected behaviour, but it is not disclosed.
