# Lane 3 — Visual complexity case studies, ranks 61–80

**Target platform:** Lightweight Charts **v5.2.0** (pinned exactly on `origin/master`, physically installed).
**Vocabulary and verdicts** follow `lane5a-lwc5-core.md` (native surface + gaps) and `lane5b-lwc5-plugins.md`
(`ISeriesPrimitive` / `IPanePrimitive` / custom series, the four zOrder paint slots, `hitTest`, and the six
hard-visual verdicts). Every source was read end-to-end. Authority: READ_ONLY_RESEARCH.

**Machine-readable companion:** `lane3-cases-61-80.json`.

---

## Headline

| | |
| --- | --- |
| Difficulty histogram | **1:0 · 2:1 · 3:5 · 4:14 · 5:0** |
| Infeasible | **0 of 20** |
| Snapshots on disk | **8 of 20** (61, 64, 69, 70, 71, 76, 77, 80); 12 missing |
| Only non-overlay script | rank 78 (`overlay=false`, its own pane, with `force_overlay` content on pane 0) |
| Only script LWC makes *easier* than Pine | rank 77 (1 500 pooled lines → 3 `LineSeries` with per-point `color`) |

**No script in this slice is infeasible.** Nothing here needs a capability LWC v5 lacks even via plugins:
every visual reduces to canvas geometry inside a primitive, a custom series, or a DOM overlay, which is the
same conclusion lane5b reaches for all six of its hard visuals ("No fork is required for any of the six").
The cost is uniformly *"the API lets you, the library helps you with none of it"* — text layout, culling,
tables, tooltips and drag are all ours to write.

---

## Per-script summary

| # | Script | Steady-state objects | Ceiling set declared | LWC5 route | Diff |
|---|---|---|---|---|---|
| 61 | Liquidity Delta Profiler [LuxAlgo] | ~120 → 480 boxes/labels + 1 table | boxes 500, labels 500 | box layer + auto-fit in-shape text + pill layer + DOM table + DOM tooltip | 4 |
| 62 | Realtime TPO Profile [Kioseff] | ~1 000 (500 rows × line+label) + 500 archived | lines/boxes/labels 500, bars_back 2000 | TPO text engine primitive + line layer + band fill + DOM table | 4 |
| 63 | ML Smart Money Concepts \| GainzAlgo | pinned at the ring buffer (≤1 800 lines/CHoCH) | labels/boxes/lines 500, bars_back 5000 | multi-pass glow stroker + quad fills + band + DOM table | 4 |
| 64 | Hourly Trading System (Zeiierman) | ~30–90 | **lines 100, labels 100, bars_back 200** | future-anchored line/box layer + renumbering pills + off-range candle pool + 2 DOM tables | 4 |
| 65 | S&R Zones [FEELS] | 48 → ~348 | lines/boxes/labels 500, bars_back 5000 | box + line + multi-line pill layers; circles native via `createSeriesMarkers` | 3 |
| 66 | Whale Liquidity & Absorption [AlgoAlpha] | 245 → **490 pooled boxes** + heatmap stream | **boxes 500, labels 20** | profile layer (7-deep pool) + in-cell text + heatmap layer w/ hand culling | 4 |
| 67 | Dynamic S/R Zones [ChartPrime] | ~200 bins + peaks + ≤500 bounce labels | labels/boxes/lines 500, bars_back 4000 | bin layer at two zOrder slots + in-cell text + gradient band | 4 |
| 68 | Risk Reward Optimiser [ChartPrime] | 15 boxes + 7 labels + 21 plots + ~80 cells | lines 500, labels 500 (**boxes default 50**) | 21 whitespace-broken `LineSeries` + off-range histogram w/ word wrap + DOM table w/ tooltips | 4 |
| 69 | Ichimoku Theories [LuxAlgo] | ~60 (hard-capped per collection) | lines 500, labels 500, polylines 100 | Kumo band split per colour run + future whitespace + polyline/line/vline/label layers | 4 |
| 70 | Liquidity Thermal Map [BigBeluga] | 31 bands ×  every bar + margin strip | **lines 500 only** (boxes/labels default 50) | **custom series** heatmap + off-range profile primitive + DOM tooltip | 4 |
| 71 | Liquidity Pools Pro [WillyAlgoTrader] | 120 → 300 + 10 SL/TP + 2 tables | lines/labels/boxes 500, bars_back 5000 | box + line + label layers + DOM dashboard; **watermark is native** | 4 |
| 72 | HTF Candle Profile [ChartPrime] | tens of bins + ≤8 lines + ≤5 labels | boxes/lines 500, **polylines 100 (unused)**, labels default 50 | box + line + label layers + a background-band primitive + pane-relative text | 3 |
| 73 | RSI-Divergence Goggles [Trendoscope] | 1 box + 2 handles + pivots + 2 polylines | lines 500, labels 500 | native rescaled `LineSeries` + **DIY mouse layer for placement/drag** + label/polyline layers + DOM tooltip | 4 |
| 74 | Supply and Demand Zones \| Flux Charts | budgeted to ≤480 boxes at run time | boxes/labels/lines 500 | one gradient rect per segment (the budget allocator disappears) + line + glyph layers | 3 |
| 75 | SuperTrend TP Dimensions [AlgoAlpha] | ≤400 boxes + 12 lines + 16 labels + 4 tables | **boxes 500 only** (lines/labels default 50) | band fill + off-range 4-panel primitive + 4 DOM tables incl. a gauge | 4 |
| 76 | Fibonacci Projection + Δ Profile (Zeiierman) | ~30 (default) → ~220 at `rows=100` | **bars_back 5000 ONLY — boxes/lines/labels all default 50** | box + line (hand-drawn arrowheads) + label layers | 3 |
| 77 | Multi Kernel Regression [ChartPrime] | **2 500 pre-allocated** vs a 500/500 budget | lines 500, labels 500, bars_back 500 | **native**: 3 `LineSeries` w/ per-point `color` + markers | **2** |
| 78 | Supertrend Parameter Sensitivity 3D [LuxAlgo] | ~339 lines + 81 linefills + 8 labels + 1 table | **lines 500 only** | one quad-mesh primitive in its own pane + cross-pane `force_overlay` + DOM dashboard | 4 |
| 79 | HTF Volume Spike & Imbalance [LuxAlgo] | ~250 boxes + 8 lines + hundreds of bubbles | boxes/lines/labels 500 | box + line + bubble layers, all off-range | 3 |
| 80 | Strong Demands & Supplies + Liquidity | large, partly unbounded | **lines 500 (declared twice), boxes 500, bars_back 500; labels default 50** | box + line + label layers + triangle markers | 4 |

---

## The three hardest, and why

### 1. Rank 62 — Realtime TPO Profile [Kioseff Trading]
A market-profile letter grid: each tick-level row is a **label whose text is the accumulated TPO string**,
appended token by token by an O(bars-in-session × rows) double loop that re-runs after a full teardown of
*every* line, label and tag **on every bar**. Up to 500 rows, strings that reach thousands of characters,
monospace column alignment, and `size.auto` fitting.

LWC gives you nothing here: `ctx.font`, `ctx.measureText`, `ctx.fillText`, and everything else by hand
(lane5b §9). You must vendor `make-font.ts` and `text-width-cache.ts`, write your own fit-to-width scaler
(the `text-watermark` renderer's `line.zoom` is the only published precedent), and add per-row culling
against `getVisibleLogicalRange()` because primitives get none. On top of that, **every anchor is a wall-clock
timestamp** — the session open, `last_bar_time`, `first - timRound` — and `timeToCoordinate` returns `null`
for any time not exactly on the scale, so all of them must be converted to integer logical indices first.

### 2. Rank 78 — Supertrend Parameter Sensitivity 3D [LuxAlgo]
A genuine isometric 3D surface built from Pine primitives: a 10×10 metric matrix projected as
`x = (i−j)`, `y = (i+j) + z`, drawn as **81 wireframe quads shaded by `linefill` and painted back-to-front**
by loop direction (a painter's algorithm), with back-wall grid lines, Z-axis scale labels and callouts.

The mesh itself is one primitive's `draw()` — 81 quad fills then their strokes in the same order. Three
things make it expensive: (a) it lives in its **own pane** while `force_overlay = true` puts the SuperTrend
plot *and* the dashboard on the **main** pane, so one Pine indicator becomes objects on two LWC panes;
(b) the surface's y range is a hard-coded 0–100, so the host pane's series must carry at least one **real**
data point or the primitive's `autoscaleInfo` is never called at all (lane5b gotcha 3 — whitespace does not
count); (c) the dashboard is a monospace **unicode block-character histogram** over a 10×10 gradient grid
with **100 per-cell tooltips**, which is trivial in HTML and miserable on canvas.

### 3. Rank 70 — Liquidity Thermal Map [BigBeluga]
The only true per-bar heatmap in the slice. 31 horizontal bands are carried by 31 invisible `plot()`s and
31 `fill()`s whose **colour is recomputed every bar** (it reads `close`, `open`, `hl2`, `hlc3` to punch a
transparent hole around the live candle) and whose **boundaries move every bar** with `ta.highest`/`ta.lowest`.
The snapshot shows the resulting staircase clearly.

This is lane5b §11(f) verbatim: it must be a **custom series**, not a primitive, because a custom series is
the only construct that gets `visibleRange` culling, `priceValueBuilder` autoscale and conflation. The data
model is exactly `HeatMapData { cells: {low, high, amount}[] }`, and `plugin-examples/heatmap-series` is the
direct template (`fullBarWidth` for the column, `positionsBox` per cell, a `cellShader` for the ramp). The
right-margin profile strip, POC caption and three multi-line tooltip pills are a *second*, separate primitive
because they sit past the last bar where a custom series cannot draw.

**Runners-up:** 61 (auto-fit text inside four stacked quadrant boxes + tooltips + dashboard), 66 (a 490-box
pool contending with a fire-and-forget heatmap for the same 500-box budget), 75 (four DOM tables including a
gradient gauge, plus an off-range four-panel mini-chart with its own axis text).

---

## LWC v5 gaps seen 3+ times

| # | Gap (lane5a/lane5b reference) | Hits |
|---|---|---|
| 1 | **No text API for pane renderers.** No font helper, no measurement cache, no pill, no multi-line, no wrapping, no auto-size, no collision avoidance. Vendor `make-font.ts`, `text-width-cache.ts` (incl. `yMidCorrection`), `canvas-helpers.ts` (`drawRoundRectWithBorder`) and the `text-watermark` multi-line renderer. (lane5b §9, §11e) | **20/20** |
| 2 | **Off-range / future anchoring.** `timeToCoordinate` → `null` for any time not exactly on the scale (gaps, weekends, future); `logicalToCoordinate(3.5)` → **`0`, silently**. Recipe: convert to an *integer* logical index (`timeToIndex(t,true)` or `lastIndex+n`), then `logicalToCoordinate`; sub-bar offsets add `fraction × barSpacing` manually. Future *anchors* need materialised whitespace slots. (lane5a §2.8, lane5b §8, gotchas 1–2) | 16 |
| 3 | **No viewport culling for primitives; cost is per-primitive, not per-shape.** 500 primitives drawing one box each is ~500× the library overhead of 1 primitive drawing 500 boxes — same pixels — and every attached primitive's `hitTest` runs on **every mouse move**. One layer primitive per Pine *object class* (`BoxLayer`, `LabelLayer`, …), never per object. (lane5b §10, §11b, §14.1) | 15 |
| 4 | **No colour-ramp helper.** `color.from_gradient` (2- and 3-stop) must be reimplemented; `ctx.createLinearGradient` covers the vertical-gradient cases (67, 74). | 10 |
| 5 | **Marker vocabulary is 4 shapes with no arbitrary character.** `circle \| square \| arrowUp \| arrowDown` only — no triangle (64, 80), diamond/cross (65, 74), `labelup`/`labeldown` (75), emoji or `plotchar` glyph (66, 72, 75, 79), and no pane-relative `location.bottom` (72). Marker `text` exists but has no pill, no font control and no de-overlap. (lane5a §2.6, §2.11) | 9 |
| 6 | **Autoscale participation.** Drawings outside the bar price range must hang off a **series** primitive's `autoscaleInfo` — pane primitives have none — and it is **never called** if the host series has no real data point (whitespace is filtered out of the plot list). `margins` is last-writer-wins, not merged. (lane5a §2.9, lane5b §8, gotcha 3) | 9 |
| 7 | **No table surface.** A Pine `table` is a pane primitive at best; the sanctioned answer for a real table (selectable text, tooltips, accessibility) is an absolutely-positioned **HTML overlay** over `chart.chartElement()`, created/destroyed from a pane primitive's `attached`/`detached` — what the official `tooltip` and `accessibility` plugins do. `zOrder:'top'` also costs a full redraw on every mouse move. (lane5b §11c) | 8 |
| 8 | **No fill between two arbitrary series, and no gradient-fill overload.** `AreaSeries` fills to a fixed base, `BaselineSeries` to a single scalar. The `bands-indicator` primitive (`drawBackground` at `'normal'`) is the pattern; a *varying* colour (69, 70) forces one closed sub-path per colour run. (lane5a §2.11, lane5b §11a) | 7 |
| 9 | **No tooltip mechanism.** `hitTest` hands you an `externalId`; you render the tooltip in the DOM. On click the identified object is whatever the **previous** mouse move resolved — fragile on touch (UNVERIFIED across all touch paths). (lane5b §6, §11c, gotcha 13) | 5 |

Seen fewer than three times but worth recording: **no `bgcolor`/per-bar background band** (72), **no arrowhead
line style** (69, 76), **no `extend.left`/`extend.right`** — clamp to the pane edge yourself (67, 80), **no
word wrapping anywhere in the library** (68), **series `LineWidth` capped at 1|2|3|4** — widths 7 and 10 appear
(63, 72), and **no drag API at all** (73), for which the DIY route is `plugin-examples/user-price-alerts/mouse.ts`
plus toggling `handleScroll.pressedMouseMove`.

---

## Mechanical-inventory errors and source anomalies found

These are disagreements between the measured `primitives`/`language` counts in `lane3_candidates.json`,
the `indicator()` declaration, and the source actually read.

1. **Rank 62 — object-creation sites undercounted.** `primitives` counts only `*.new` call sites and misses
   **`line.copy` ×4** (lines 822, 823, 826, 832) and **`label.copy` ×1** (line 830). Both create new drawing
   objects. True creation-site counts: lines 15→19, labels 13→14.
2. **Ranks 61 and 78 — method-call syntax invisible to the inventory.** Both write their tables with the
   method form `t_able.cell(...)`, so `table.cell` is **absent from `primitives` entirely** (rank 61 shows
   `table.new×1` and no cells; rank 78 the same) while rank 61 writes ~30 cells and rank 78 ~120. The same
   blindness applies to `b.delete()`, `l.delete()`, `x.set_left()` etc. throughout the slice.
3. **Rank 68 — helper-wrapped calls collapse to one.** `table.cell×1` is the single call site inside the
   `Cell(c,r,Text,bg)` helper (line 394); the dashboard actually writes ~80 cells per redraw, plus
   `table.cell_set_tooltip` and `table.cell_set_bgcolor`, which are different functions and uncounted.
   Rank 61's `cell()` helper is the same pattern.
4. **Rank 64 — a counted call site is unreachable.** `line.new×4` includes the `line.new` inside `Line_Vert()`
   (line 75), but **`Line_Vert` is never called** — both call sites are commented out (lines 146, 180).
   Reachable count is 3.
5. **Rank 72 — a declared ceiling with no consumer.** `max_polylines_count = 100` is declared but the source
   contains **no `polyline.new`**. (The inventory is right; the *declaration* is vestigial.) Rank 72 also
   pushes every rebuilt `Profile` record onto `ProfileDraws` and never pops it — the drawings are deleted but
   the record list grows.
6. **Ranks 70, 75, 76, 78, 80 — ceilings are implicit, and the inventory does not record them.** These scripts
   omit one or more of `max_boxes_count` / `max_lines_count` / `max_labels_count`, so **Pine's default of 50
   applies**. The consequential one is **rank 76**, which declares *only* `max_bars_back = 5000`: with
   `rows` raised toward its maximum of 100 the volume profile alone wants ~200 live boxes against a 50-box
   default, so Pine silently destroys the oldest. Rank 80 has no `max_labels_count` while structure and swing
   labels accumulate forever (`mode = 'Historical'` never deletes them), so only the most recent ~50 survive.
7. **Rank 80 — duplicated named argument.** The declaration reads
   `indicator(..., max_lines_count=500, max_lines_count = 500, max_boxes_count = 500, max_bars_back = 500, overlay = true)`
   — `max_lines_count` appears **twice**. It also calls `max_bars_back(time, 1000)` while declaring
   `max_bars_back = 500`.
8. **Rank 77 — the declared ceiling is oversubscribed 3×.** It declares `max_lines_count=500` /
   `max_labels_count=500` but allocates **1 500 lines** (3 arrays × 500) and **1 000 labels** (2 × 500) at
   `barstate.isfirst`, so the deviation bands and the estimate curve contend for one 500-line ring.
   Note also the subtlety that `array.new<line>(500, line.new(...))` fills all 500 slots with the *same*
   object; the distinct per-slot lines only exist after the `for i = 499 to 0` `array.set` loop.
9. **Rank 63 — the static count badly understates runtime.** `line.new×20` is correct as a call-site count,
   but the wick-glow loop emits **4–6 lines per bar of a trace up to 300 bars long** — up to ~1 800 lines for
   a single CHoCH — against `max_lines_count=500`. The ceiling is the only garbage collector in the script.
10. **Rank 66 — the pool and the stream fight for the same budget.** Seven box arrays × `profileBins`
    (up to 70) = **490 pooled boxes** against `max_boxes_count = 500`, while the historical heatmap emits
    up to 70 more boxes every 5 bars. The source's own tooltip acknowledges this: it says the heatmap stays
    "until TradingView's box limit removes older boxes".
11. **Rank 78 — `linefill` has no ceiling of its own.** `indicator()` exposes no `max_linefills_count`;
    linefills die with their parent lines, so the 81 facets survive because the ~339 lines fit inside the
    500-line budget. The inventory's `linefill.new×1` is a call-site count hiding an 81-object population.
12. **Snapshots missing for 12 of 20.** Absent from `acq\snapshots\`: 62 (`P9aVc7vy`), 63 (`uGCtOz0Y`),
    65 (`EYO7FUhF`), 66 (`cWm8UcfQ`), 67 (`lrYnTj06`), 68 (`cuWPYbhn`), 72 (`5d1au2Dh`), 73 (`RXYE7B2a`),
    74 (`ZUAYemgd`), 75 (`tb1TiNJe`), 78 (`kSMLs0Hh`), 79 (`MXn4pESD`). Their visuals were reconstructed
    from source only and are marked `snapshot_seen: false` in the JSON.

All other `primitives` counts I checked line-by-line (ranks 61, 63, 64, 65, 67, 69, 70, 71, 72, 73, 74, 75,
76, 77, 78, 79, 80) **matched the source exactly**, as did `tv_stats` for every script that carries it.

---

## Object-management idioms worth naming (they are the port's real design input)

Across 20 scripts the drawing-object lifecycle falls into exactly seven patterns. A Pine→LWC transpiler needs
a model for each; in LWC all seven collapse into "update the layer's model array, then `requestUpdate()`".

| Idiom | Where | LWC equivalent |
|---|---|---|
| **Fire-and-forget, ring buffer as GC** — objects created and never tracked; `max_*_count` evicts them | 63, 66 (heatmap), 78, 80 (structure) | An explicit cap on the model array; nothing evicts for you |
| **Fixed pre-allocated pool, mutate only** | 66 (7×bins), 77 (2 500 slots), 64 (HTF candle), 80 (order blocks) | Just a model array; the pool exists only to dodge Pine's ceilings |
| **Delete-all-and-rebuild under `barstate.islast`** | 65, 67, 70, 72, 73, 74, 79 | Rebuild the model, `requestUpdate()` |
| **Capped array with explicit eviction + per-member delete** | 61, 69, 71, 80 (liquidity) | Same cap on the model |
| **Hide without deleting** — `set_x(na)`, `set_xy(na,na)`, or collapse geometry to zero width | 61, 71, 77 | Omit the model from the frame |
| **`delete(obj[1])` — history-referenced deletion of last bar's instance** | 64, 80 | A single mutable model entry |
| **Run-time object-budget allocator** — gradient resolution divided by remaining box budget | 74 (`steps = min(8, 480/segs)`) | **Disappears**: one `createLinearGradient` fill |

Two Pine-only constraints vanish entirely in LWC and should not be ported: **`max_bars_back` clamping**
(rank 65's `safeStartBar`, rank 68's `max_bars_back(Hi,50)`) and the **`xloc.bar_time`-to-dodge-bar-distance
trick** (rank 71 uses it explicitly for that reason). LWC's `indexToCoordinate` is affine and unclamped, so
negative and far-future integer indices both resolve correctly.
