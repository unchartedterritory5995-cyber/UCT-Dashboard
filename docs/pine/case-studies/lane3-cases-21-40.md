# Lane 3 — visual complexity case studies, ranks 21–40

**Scope:** ranks 21–40 of the measured complexity ranking in `acq/lane3_candidates.json`.
**Target:** a Pine Script renderer on Lightweight Charts **v5.2.0** (the version settled in lane 5A).
**Authority:** READ_ONLY_RESEARCH. Date: 2026-09-08.
**Method:** every one of the 20 `.pine` sources was read in full from `acq/sources/`. Vocabulary and
verdicts follow `lane5a-lwc5-core.md` (native surface + gaps) and `lane5b-lwc5-plugins.md`
(primitive API, four zOrder slots, hitTest, custom series, the six hard-visual verdicts).
Structured form of everything below: **`lane3-cases-21-40.json`** (same directory), which also
carries a canonical `gap_glossary`, per-script `lwc5_gap_ids`, and the computed `gap_frequency`.

---

## Snapshot coverage — read this before trusting any "what it draws"

Only **3 of 20** scripts have a PNG on disk. I cross-checked every one of the 20 by `scriptIdPart`
against `acq/snap_manifest.json`, not just by the `snapshot_file` path in the candidates file:

| Snapshot present | Rank | File |
|---|---|---|
| yes | 24 — ICT Killzones & Pivots [TFO] | `acq/snapshots/nW5oGfdO.png` |
| yes | 32 — ICT Concepts [LuxAlgo] | `acq/snapshots/ib4uqBJx.png` |
| yes | 34 — Mirage Liquidity Sweep Pro | `acq/snapshots/qBUHu6aW.png` |
| **no** | 21, 22, 23, 25, 26, 27, 28, 29, 30, 31, 33, 35, 36, 37, 38, 39, 40 | path in `lane3_candidates.json` points at a file that does not exist; `snap_manifest.json` has no entry for the scriptId either |

For those 17 the `what_it_draws` field is **reconstructed from source only**. `snapshot_url` is
recorded for all 20 regardless. Where a snapshot did exist it changed nothing material — but it did
confirm details worth having, e.g. rank 34's win-rate gauge really is rendered as a row of block
glyphs inside a table cell, and rank 24's session names really are drawn as large low-opacity text
centred in the session box.

---

## Difficulty histogram

| Difficulty | Count | Ranks |
|---|---|---|
| 1 — native series/markers, no plugin | 0 | — |
| 2 — one straightforward primitive | 0 | — |
| 3 — primitive + real bookkeeping | **1** | 30 |
| 4 — multiple coordinated primitives / custom series / a text-layout engine | **19** | 21–29, 31–40 |
| 5 — needs a capability LWC v5 lacks even via plugins | **0** | — |

**The scale saturates in this band, and that is itself the finding.** Ranks 21–40 of a 150-script
complexity ranking are, almost without exception, multi-family drawing engines with a dashboard
table attached: three or more Pine object classes, at least one pool with an eviction policy, at
least one anchor past the last bar, and text that needs real layout. Under lane5b §14's
"one layer primitive per Pine *object class*" architecture, that is by definition a 4.

So difficulty is **not** the useful discriminator here. What separates these scripts is *which*
gaps they hit and how hard each one bites — which is why the JSON carries `lwc5_gap_ids` and a
frequency table, and why `difficulty_reason` names the single hardest piece per script rather than
restating the tier.

Rank 30 (`All Chart Patterns`) is the one genuine 3: two object classes, a **fixed** 156-object set
(100 lines + 56 labels) created once at bar 0 with `na` anchors and only ever repositioned, no
pools, no deletes anywhere in the file, single-line label text, no future coordinates, no table.

---

## Infeasible: **0 of 20**

Nothing in this slice needs a capability LWC v5.2.0 lacks, even via plugins. I checked every
candidate against lane5b before ruling, and each has a named path:

| Candidate for "infeasible" | Where | Why it is not |
|---|---|---|
| Per-object tooltips on labels, boxes and table cells | 24, 33, 34, 36 | `hitTest` → `PrimitiveHoveredItem.externalId` → `MouseEventParams.hoveredInfo.objectId` on `subscribeCrosshairMove`, rendered by a DOM overlay. This is the official `tooltip` plugin pattern. |
| `line.all` / `box.all` / `label.all` / `linefill.all` global registries, incl. deleting a *library's* objects | 31, 36 | A runtime feature, not a rendering capability. The renderer owns every object it creates, so an ordered registry with Pine's pop/shift/delete semantics is ours to build. |
| Line width 10 (rank 21) and up to 100 (rank 40) | 21, 40 | `LineWidth = 1\|2\|3\|4` is a native cap on series and price lines only. Inside a primitive, `ctx.lineWidth` takes any value. |
| Arbitrary character glyphs (`plotchar`, `⬤`, `▰▱`, `🚀`, `🟩🟥`, `▲▼`, `◂`) | 24, 25, 27, 28, 34, 36, 37 | Canvas `fillText`/`strokeText`. Not a marker, which is the actual gap. |
| An entire second cartesian chart in the price pane (Kaplan-Meier panel) | 28 | The author already remapped it into price coordinates; a series primitive draws it and contributes `autoscaleInfo` so it stays in view. |
| Per-tick animation | 27 | `requestUpdate()` from our own timer; `expiring-price-alerts` is the precedent. |
| RTL / bidirectional label and table text | 26 | Canvas honours `ctx.direction`; a DOM table gets it free. Fidelity risk, not a capability gap. |
| `polyline(curved = true)` | 31 | Path2D béziers. The **spec** is unpublished, so pixel parity is **UNVERIFIED** — a parity risk, explicitly not an infeasibility. |
| Pine's automatic per-type FIFO eviction (`max_*_count`) | 22, 23, 38 | Not an LWC capability at all; it is a runtime behaviour the renderer must reimplement. Named as a gap, not a blocker. |

Two things adjacent to rendering are genuinely **out of a renderer's scope** and are labelled that
way rather than as infeasible: `request.security` / `request.security_lower_tf` MTF data
(ranks 23, 29, 33, 39) and Pine's execution model / `alertcondition`.

---

## Every LWC gap seen in more than two scripts

Canonical ids and full definitions are in `gap_glossary` in the JSON.

| n | Gap | Ranks |
|---|---|---|
| 20 | **GAP_DRAWING_OBJECT_LAYER** — Pine's whole line/box/label/polyline/table layer is absent | all 20 |
| 20 | **GAP_LEGEND** — no legend, status line, pane title or value readout | all 20 |
| 19 | **GAP_TEXT_LABEL** — no free-floating text label; marker text is one plain string, no font/size/align/pill/multi-line | 21–39 |
| 18 | **GAP_BOX** — no rectangle primitive | 21–29, 31–33, 35–40 |
| 16 | **GAP_FUTURE_COORDS** — anchors past the last bar; `timeToCoordinate` returns `null`, `logicalToCoordinate` returns **0** for a non-integer | 21–23, 25–29, 32–37, 39, 40 |
| 13 | **GAP_TABLE** — no table (DOM overlay per lane5b (c)) | 21–27, 34–38, 40 |
| 12 | **GAP_MARKER_SHAPES** — only `circle\|square\|arrowUp\|arrowDown`; triangle, diamond, xcross, labelup, labeldown absent | 21–23, 25, 28, 32, 34–36, 38–40 |
| 10 | **GAP_PRIMITIVE_COST** — per-primitive not per-shape; one primitive per Pine object is the wrong architecture | 21, 26, 29–32, 35–37, 40 |
| 7 | **GAP_TEXT_IN_SHAPE** — Pine box text with `text_halign`/`text_valign` has no counterpart | 28, 29, 31–33, 37, 39 |
| 5 | **GAP_EXTEND_RAY** — `extend.right`/`extend.both` have no analogue | 22, 32, 33, 37, 38 |
| 5 | **GAP_FILL_BETWEEN** — no fill between two plots/series/lines (`fill()`, `linefill`) | 26, 27, 33, 36, 38 |
| 5 | **GAP_TIME_BOUNDED_HLINE** — price lines always span the whole pane | 22, 24, 25, 34, 35 |
| 5 | **GAP_VIEWPORT_CULL** — primitives get no `visibleRange`; only custom series do | 23, 31, 36, 39, 40 |
| 4 | **GAP_LABEL_COLLISION** — the library de-overlaps price-axis labels *only* | 21, 24, 26, 33 |
| 4 | **GAP_MTF_DATA** — `request.security*`, out of a renderer's scope | 23, 29, 33, 39 |
| 4 | **GAP_SLOPED_LINE** — no two-point line between arbitrary anchors | 22, 23, 26, 30 |
| 4 | **GAP_TOOLTIP** — no hover text on drawings or cells | 24, 33, 34, 36 |
| 4 | **GAP_VERTICAL_LINE** — no vertical line at a bar | 24, 33, 36, 38 |
| 3 | **GAP_OBJECT_CAP_FIFO** — Pine's `max_*_count` eviction is load-bearing where scripts never delete | 22, 23, 38 |
| 3 | **GAP_PLOTCHAR_GLYPH** — `plotchar`/arbitrary character is not expressible as a marker | 24, 25, 28 |

Seen exactly twice, listed because two of them are architectural rather than cosmetic:
`GAP_BGCOLOR` (25, 32), `GAP_GLOBAL_REGISTRY` (31, 36), `GAP_LINE_WIDTH` (21, 40),
`GAP_MARKER_PANE_ANCHOR` (24, 38), **`GAP_PANE_PRIMITIVE_AUTOSCALE` (21, 28)**,
`GAP_PER_POINT_LINE_STYLE` (27, 34), `GAP_SESSION_CALENDAR` (24, 32), `GAP_TEXT_METRICS` (34, 37).
Once only: `GAP_ANIMATION` (27), `GAP_CURVED_POLYLINE_SPEC` (31), `GAP_PLOT_STYLE_CROSS` (38),
`GAP_SECOND_VISIBLE_AXIS` (28).

### Three consequences worth pulling out

1. **Future anchoring is the norm, not an edge case.** 16 of 20 draw past the last bar; rank 29
   draws *nothing else*. Lane5a's whitespace recipe and lane5b's gotcha #2 are not optional
   background reading for this band — `logicalToCoordinate(3.5)` returning `0` silently will
   produce drawings pinned to the left edge with no error anywhere.
2. **Text is the dominant cost, not geometry.** 19/20 need a real text renderer, 13 need a table,
   7 need text laid out inside a shape, 4 need collision handling, 4 need tooltips. Ranks 26 and 24
   already ship label-placement algorithms in Pine that a faithful port has to match.
3. **Only one script (30) would survive the naive "one primitive per Pine object" mapping.**
   Everything else has ≥100 objects in at least one class — rank 21 has ~300 boxes, rank 36 ~1100
   objects across three classes, rank 40 ~92 polylines carrying ~108,000 stroked segments.

---

## The three hardest, and why

### 1. Rank 36 — `Volume Dots` (KioseffTrading, 3,597 agrees, v5, MPL-2.0)

The widest spread of distinct mechanisms in the band. Its markers are not markers: each "dot" is a
`label.style_text_outline` glyph (a filled circle character drawn with an outline and no pill),
sized across **five discrete size constants by rank**, coloured by direction, and carrying a
**per-dot tooltip** with formatted volume and open-interest figures — up to 500 of them, each a
separate hover target needing its own `externalId` and a spatial index in `hitTest`. Around that:
horizontal rays projected 40 bars into the future, a **5×20 `matrix<box>` heatmap grid**, a
liquidation band whose outline is assembled from individual `line.new` segments closed with
`linefill`, outlined text tags at intervals, and two tables (one requesting
`font.family_monospace`).

Two mechanisms have no LWC analogue at all. It reads `chart.left_visible_bar_time` /
`chart.right_visible_bar_time` so **its input set changes as the user scrolls** — ironically easier
in LWC, where `getVisibleLogicalRange()` is readable inside `updateAllViews()` on every frame
without re-execution. And it performs a **global sweep-and-delete by exclusion**: it takes
`box.all`, `label.all`, `line.all` and `linefill.all` and destroys every object *not* present in its
own matrices. That demands a renderer-level ordered object registry with Pine's semantics.

### 2. Rank 26 — `Dynamic Support and Resistance with Trend Lines (Multi-Language)` (ata_sabanci, 3,520 agrees, v6)

Lane5b (e) says the library will not help with label placement and that this is "the item most
likely to be under-estimated". This script is the proof: it ships a **six-step anti-overlap
pipeline** in Pine — collect `LabelCandidate` UDTs (price, draw_price, text, colour, priority 1–3,
group id, x) → bubble-sort by price → **cross-group proximity merge** into compound `"Static R | POC"`
labels at the midpoint, with same-group labels protected → re-sort → **priority-aware nudge over 5
convergence passes**, pushing the lower-priority label and splitting displacement evenly on ties →
draw. Visual parity means reproducing that, in pixel space rather than the ATR-multiple space Pine
was forced into.

On top: seven languages including **Arabic, Farsi and Hebrew with explicit U+200E LRM marks**, a
`linefill` between two sloped pivot trendlines, zone edges drawn solid to the current bar and dashed
for the projection (four lines per zone), and a **6×60 table with merged section headers containing
a 5×5 supply/demand confluence heatmap** — 360 cells, the strongest DOM-overlay case in the slice.

### 3. Rank 31 — `Zig-Zag Volume Profile [Kioseff Trading]` (3,120 agrees, v5, MPL-2.0)

Unbounded geometry plus a runtime dependency. Each zigzag leg gets **two filled polyline
silhouettes** with `ROWS` up to **2,000** rows → roughly 4,000 vertices per leg, and an optional
`curved = true` mode whose smoothing TradingView has never published, so **exact parity is
UNVERIFIED** (lane5b (d)). Point-of-control and value-area levels are drawn as **zero-height boxes**
used as horizontal rays and truncated by `set_right` when price violates them. Delta text is
`label.style_none` coloured through `color.from_gradient` over sorted positive/negative slices, and
the coordinate model is `matrix<chart.point>` with columns added and removed each tick.

The hard part is not the pixels. This script calls `line.all.last().get_x2()` to discover where the
**imported `TradingView/ZigZag/6` library** put its last pivot, and `polyline.all.pop().delete()` to
destroy its own live profile — it depends on a global, ordered, cross-module drawing registry that
LWC has no concept of.

**Honourable mentions.** Rank 28 (`High Probability Order Blocks`) draws an entire second cartesian
chart — X and Y axes, dotted grid, `0%…100%` tick labels, axis titles, two Kaplan-Meier step curves
— remapped into price space between `bar_index+50` and `bar_index+500`, and is the clearest
illustration in the slice of *why* Pine authors fake a second axis: LWC's overlay price scales are
hidden and force-autoscaled, and its panel must be a **series** primitive because
`IPanePrimitiveBase` has no `autoscaleInfo`. Rank 21 (`Liquidity Structure & Order Flow [LuxAlgo]`)
carries ~300 heatmap/delta boxes, closed filled polylines bulging out of a spine 100 bars in the
future, a width-10 glow line, and a **three-lane bubble packer** that is a label-placement pass in
all but name.

---

## Mechanical-inventory errors found

The `primitives` / `language` strings in `lane3_candidates.json` come from `acq/inventory.py`, which
is regex-based over comment- and string-stripped source. I read that script to characterise its
blind spots precisely rather than guess. **Every count of `label.new` / `line.new` / `box.new` /
`polyline.new` / `table.new` / `plot*` I spot-checked was correct** — the false negatives are all in
the *other* columns, and they are systematic, not random.

**E1 — `delete` counts only namespace-form deletes; method-form `.delete()` is invisible.**
`object_pool.deletes` matches `(?<![\w.])(label|line|box|polyline|linefill|table)\.delete\s*\(`, so
`myBox.delete()`, `arr.shift().delete()` and `item.bx.delete()` are all missed. Confirmed
zero-vs-many at:

| Rank | Reported `deletes` | Actual method-form deletes |
|---|---|---|
| 24 | 0 | ~20 (`k._box.pop().delete()`, `lns.pop().delete()`, … throughout) |
| 28 | 0 | 12 (`kmAxisX.delete()`, `gl.delete()`, `lb.delete()`, `bullKmCurve.delete()`, …) |
| 29 | 0 | 5 (`dLevels.body.shift().delete()`, `polys.delete()`, …) |
| 31 | 0 | ~10 (`id.shift().delete()`, `polyline.all.pop().delete()`, …) |
| 32 | 0 | many (`clear_aLabLin()` pops and deletes eight arrays) |
| 36 | 0 | many (`dotMat.Circle.shift().delete()`, `grid.get(i,x).delete()`, …) |
| 39 | 0 | 3 (inside `clearAll`) |

Ranks 24, 28, 29, 31, 32, 36 and 39 are all reported as scripts that never delete anything. All
seven are aggressive deleters. Any downstream analysis of "object lifecycle policy" built on this
column is wrong.

**E2 — `table.cell` and `table.merge_cells` are missed when called in method form.**
`find_calls` requires the literal text `table.cell(`. Confirmed:

- Rank 21 reports **no `table.cell` at all** yet writes ~25 cells through a `cell(table t, …)`
  helper that calls `t.cell(...)`; its `table.merge_cells` count of 1 also undercounts (three
  `divider()` calls each merge a row via `t.merge_cells`).
- Rank 40 reports no `table.cell`; it writes ~15 through the same `t_able.cell(...)` helper shape.
- Rank 36 reports no `table.cell`; it writes ~11 via `tab.cell(...)` / `liqtab.cell(...)`.

So the table workload of three scripts reads as zero.

**E3 — `_setters` is namespace-only too.** Rank 28 reports `{box.get_top: 8, box.get_bottom: 8,
box.set_right: 2}` and misses `b.set_text` / `set_text_halign` / `set_text_valign` /
`set_text_color` / `set_text_size` (10 calls) plus `mB.set_x2` / `mS.set_x2` (2). Rank 31 reports no
setters at all despite `id.last().set_right(...)`, `.set_top(...)`, `.set_rightbottom(...)`,
`idx.get(i).set_textcolor(...)`, `.set_text(...)`.

**E4 — `array_of_drawings` misses the v4-style constructors entirely, and whitespace defeats the
`[]` form.** The pattern is `array\.new<\s*(line|label|box|polyline|linefill|table)\s*>` **or**
`array<…>` **or** `(line|label|box|polyline)\[\]`. It therefore does **not** match
`array.new_line()` / `array.new_box()` / `array.new_label()` / `array.new_linefill()`, and does not
match `line []` with a space. Rank 27 declares **19** drawing arrays (17 of them written as
`var line [] n = array.new_line(1)`) and is reported as `arr<draw> = 6`. Rank 24 makes 20
`array.new_box()/new_line()/new_label()` calls and is reported as 27 — a number that happens to look
right but is counted from the `line[]`/`label[]` *field declarations* inside its six UDTs, not from
its pools. The same conflation inflates rank 37's 66. Also: the `[]` alternation omits `linefill`.

**E5 — positional declaration arguments are not captured.** `declaration_args` only records
arguments matching `name=`. Rank 24 is
`indicator("ICT Killzones & Pivots [TFO]", "KZP [TFO]", true, max_labels_count = 500, …)` — its
`overlay`, `title` and `shorttitle` are positional, so `declaration_args` shows only the three
`max_*_count` values and rank 24 appears to have no `overlay` setting at all. (The candidates file's
separate `overlay_per_tv` field is correct; the inventory's own view is not.)

**E6 — `enum` is not tracked at all.** There is no counter for it, so rank 29's
`enum modelType { regVP, deltaVP }` — a Pine v6 construct that drives its whole model switch — is
invisible in the `language` column.

**E7 — call-site counts are not object counts, and the `primitives` string invites the confusion.**
Rank 40 reads `polyline.new×3`; at runtime it holds **~92** polylines (2 × up to 45 bins, plus 2
delta combs). Rank 21 reads `box.new×4`; it holds **~300**. Rank 30 reads `line.new×100` and here
the two numbers coincide exactly, because every one of its 100 lines is a `var` singleton. This is
not a bug in `inventory.py` — it measures what it says it measures — but any ranking or capacity
planning that treats these as object counts will be off by one to two orders of magnitude, in both
directions.

---

## Per-script index

| Rank | Script | Author | Agrees | v | Diff | The one thing that costs the most |
|---|---|---|---|---|---|---|
| 21 | Liquidity Structure & Order Flow [LuxAlgo] | LuxAlgo | 5,634 | 6 | 4 | three-lane bubble packer — a label-placement pass in all but name |
| 22 | RenderingNature SMC Reversal Engine v7.1 | renderingnature1 | 4,667 | 6 | 4 | pill/triangle glyph vocabulary + three coexisting lifecycle policies |
| 23 | Elliot Wave Detector Pro | GoodBadBitcoin | 3,151 | 6 | 4 | multi-line captions in pills; relies on `max_*_count` as its only GC |
| 24 | ICT Killzones & Pivots [TFO] | tradeforopp | **55,290** | 6 | 4 | six sessions across 28 timezones + same-price label merge + 20×20 table with per-cell tooltips |
| 25 | ICC Market Structure and Phase Tracking | jadetrue | 2,128 | 6 | 4 | `bgcolor()` phase bands, re-derived per visible range on every scroll |
| 26 | Dynamic S&R with Trend Lines (Multi-Language) | ata_sabanci | 3,520 | 6 | 4 | a full label merge+nudge engine, RTL text, 360-cell table with a heatmap |
| 27 | SuperTrend Optimizer | KioseffTrading | 3,210 | 5 | 4 | `fill()` between two plots (×2) + the only time-driven animation loop in the band |
| 28 | High Probability Order Blocks [AlgoAlpha] | AlgoAlpha | 4,905 | 6 | 4 | an embedded Kaplan-Meier chart with its own axes, 50–500 bars into the future |
| 29 | Multi Timeframe Volume Profiles [TradingIQ] | Trading-IQ | 3,088 | 6 | 4 | 100% of the output is past the last bar; whitespace grid is load-bearing |
| 30 | All Chart Patterns [theEccentricTrader] | theEccentricTrader | 3,731 | 6 | **3** | nothing — 156 fixed singletons with `na` anchors; the simplest case here |
| 31 | Zig-Zag Volume Profile [Kioseff Trading] | KioseffTrading | 3,120 | 5 | 4 | 4,000-vertex curved filled silhouettes + `.all` registry mutation across modules |
| 32 | ICT Concepts [LuxAlgo] | LuxAlgo | 29,695 | 5 | 4 | mixed bar-index/bar-time anchoring, incl. wall-clock times that are not bars |
| 33 | ICT Premium/Discount | Giovanni-1- | 2,466 | 5 | 4 | `linefill` bands + millisecond-arithmetic future anchors + split-on-fill boxes |
| 34 | Mirage Liquidity Sweep Pro | WillyAlgoTrader | 7,968 | 6 | 4 | a dozen mutating price pills + a dashboard whose gauges are block glyphs |
| 35 | Liquidity Entry Zones [trade_w_samet] | tradewsamet | 5,572 | 6 | 4 | corner-bracket glyphs built from 8 primitives per signal (draw as one path) |
| 36 | Volume Dots | KioseffTrading | 3,597 | 5 | 4 | outlined-glyph scatter with 500 hover targets + global sweep-by-exclusion |
| 37 | CHoCHs+Nested Pivots+FVGs+Grade Sweeps | twingall | 4,263 | 5 | 4 | in-box text positioned by *padding the string with spaces* — font-metric parity |
| 38 | [ A L P H A X ] Elliott Wave & Fib Golden Zone | AlphaX-Trade | 2,133 | 6 | 4 | `plot.style_cross` (absent) + a direction-flipping cloud fill |
| 39 | Order Blocks Volume Delta 3D \| Flux Charts | fluxchart | 5,633 | 6 | 4 | faux-3D extrusion (a shear in bar/price space) rebuilt every bar |
| 40 | Volumetric Regression Heatmap [LuxAlgo] | LuxAlgo | 2,307 | 6 | 4 | ~108,000 stroked segments per repaint at band widths up to 100px |

Full per-script `what_it_draws`, `drawing_objects_managed`, `object_management`,
`pine_features_load_bearing`, `lwc5_approach`, `lwc5_gaps_hit` / `lwc5_gap_ids`,
`difficulty_reason` and `infeasible` / `infeasible_why`: **`lane3-cases-21-40.json`**.
