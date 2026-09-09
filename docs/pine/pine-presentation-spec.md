# Pine Script v6 — Presentation-Layer Specification

**Canonical reference for a from-scratch Pine renderer.** This document is the build target and the
test oracle: every observable behaviour a renderer must reproduce is stated here as an assertion,
and every gap in the record is stated as a gap.

---

## 1. Scope and provenance

### 1.1 What this covers

The complete **presentation surface** of Pine Script v6 — everything that puts pixels on a chart —
at argument level:

| Family | Members specified |
|---|---|
| Plot family | `plot()`, `plotshape()`, `plotchar()`, `plotarrow()`, `plotcandle()`, `plotbar()` — 6 functions, **85 parameters** |
| Fills / backgrounds / colour | `fill()` (3 overloads), `hline()`, `bgcolor()`, `barcolor()`, `color.*` (7 functions + 17 constants) |
| Labels | `label.new()` (2 overloads) + 20 further functions + `label.all` |
| Lines / linefills | `line.new()` (2 overloads) + 20 further functions + `line.all`; `linefill.*` (5 functions + `linefill.all`) |
| Boxes | `box.new()` (2 overloads) + 28 further functions + `box.all` |
| Polylines / chart points | `polyline.new()`, `polyline.delete()`, `polyline.all`; `chart.point` type + 5 constructors |
| Tables | `table.new()`, `table.cell()`, 11 cell setters, 6 table setters, `clear`, `merge_cells`, `delete`, `table.all` |
| Declaration | `indicator()` — 17 parameters — plus `force_overlay`, `explicit_plot_zorder`, `behind_chart`, `scale`, `format`/`precision` |
| Cross-cutting | z-order, object limits, rollback/realtime, `na` semantics, coordinate semantics, qualifier lattice, version-keyed rendering |

Out of scope: `strategy()`-specific parameters, `request.*`, `input.*`, `alert*`, TA functions, the
type system beyond what drawing objects need.

### 1.2 The authority

**The authority for every signature, parameter type, `required` flag, allowed-constant list and
documented default in this document is TradingView's own Pine v6 Reference Manual data payload.**

The reference page `https://www.tradingview.com/pine-script-reference/v6/` is a client-rendered SPA:
a plain fetch returns a ~129 KB shell with zero reference content (`grep -c "table.new"` on the
served HTML = 0). The data was therefore extracted from the page's own webpack chunk graph:

1. `pine_script_reference.<hash>.js` → `ReferenceRenderer.loadReference()` → `getReference(PineLanguage.V6)`
2. That resolves webpack module **`742609`** in chunk **`42609.c7bb2b1ef75d75427a01.js`** (1.29 MB);
   English strings live in `en.41280.c3103bbd9613b8c6938e.js`, `en.81395.c3ea6fa280511b1fcf65.js`,
   `en.21857.4889c7a70444e16ac9c7.js`, `en.32258.7d600bc1e22f86336458.js`
3. Chunks evaluated in a Node `vm` sandbox with a shimmed webpack `require` and a shimmed
   `i18n.t()` that resolves `{placeholder}` substitutions, then serialised to JSON

Resulting payload — **the same data the reference page and the Pine editor render**:

| Collection | Count |
|---|---|
| `functions` | 719 |
| `methods` | 251 |
| `constants` | 239 |
| `variables` | 161 |
| `keywords` | 23 |
| `operators` | 23 |
| `types` | 20 |
| `annotations` | 10 |

Each function entry carries per-argument `name`, `desc`, `required`, `displayType` and
`allowedTypeIDs` (the authoritative type gate), plus function-level `desc`, `remarks`, `examples`
and `returnedTypes`. Local artefact: `scratchpad/v6ref.json` (identical to
`scratchpad/research/pine_v6_reference.json`, an independent parallel extraction — the two agree).

**Secondary sources**, used only for behaviour the reference does not describe, and always labelled:

| Tag | Source |
|---|---|
| `[UM]` | User Manual, `https://www.tradingview.com/pine-script-docs/visuals/{plots,text-and-shapes,bar-plotting,fills,colors,backgrounds,bar-coloring,levels,lines-and-boxes,tables,overview}/`, `/writing/limitations/`, `/language/{execution-model,type-system}/`. Note: every `/pine-script-docs/concepts/…` URL now 301-redirects to `/visuals/…`. |
| `[RN]` | Official release notes |
| `[BLOG]` | TradingView blog (gradient-fill launch post) |
| `[HC]` | Help Center (indicator chaining limits) |

**Precedence rule, applied throughout: where a secondary source and the reference payload disagree,
the payload wins and the disagreement is recorded in §9.** Where the payload is silent and a
secondary source is not, the fact is tagged with its source and its weaker provenance is explicit.

**Date gathered: 2026-09-08.** The chunk hashes above will rot when TradingView redeploys; the
extraction *recipe* is the durable part. v6 shipped November 2024 and is a **moving target** — 19
language/API changes landed into v6 between Feb 2025 and Aug 2026 `[RN]`.

### 1.3 What was NOT done, and what that leaves uncertain

> **No claim in this document was confirmed by running Pine on a live chart.** This is a
> documentation-level specification, built from first-party product data and first-party prose. It
> has not been differentially tested against the real renderer on a single bar.

What that leaves uncertain, in order of renderer impact:

1. **Everything geometric.** Pixel geometry, anchor points and "with text" variants of the 12
   `shape.*` marks and the 21 `label.style_*` marks are documented only as *images with no alt
   text*. No textual description of any of them exists in any source. Dash/dot periods, arrowhead
   sizes, balloon tail offsets, the gap between a bar extreme and a `yloc.abovebar` label — all
   undocumented.
2. **`plotarrow()` normalisation.** "Proportional to the relative value of the series on that bar in
   relation to other series values" is the whole specification. Denominator, linearity and the
   degenerate all-equal case are unstated.
3. **The curved-polyline spline family.** Documented as "nonlinear", "smooth piecewise function",
   interpolating, overshoot-capable. Never named.
4. **Failure modes.** What happens at `x > bar_index + 500`, at `x < bar_index - 10000`, on an
   `xloc`/constructor mismatch, on a >10,000-point polyline, on a multi-codepoint `plotchar` — every
   one of these is documented as "cannot be drawn" / "will not work" / not at all. Clamp vs drop vs
   runtime error is unknown in every case.
5. **Autoscale participation.** The word "autoscale" does not appear in the reference payload at
   all. Whether a label or an extended ray at an extreme price expands the pane's price range is
   unknown.
6. **Clipping and collision.** Zero statements anywhere about label clipping at a pane edge,
   nudging drawings into view, or overlap resolution between drawing objects. Official examples make
   spacing the script author's job.

Full deduplicated register: **§8**. Every item there is a live question, not a stylistic caveat.

---

## 2. The z-order model

Two lanes derived this model independently — one from `[UM]` *Visuals / Overview* via the fills/colour
surface, one via the tables/declaration surface — **and they agree exactly**: same nine buckets, same
order, same within-bucket rule, same single exception, same `barcolor()` exclusion. The list below is
the reconciled result; no reconciliation edits were needed.

### 2.1 The nine buckets, ascending (bottom → top)

| # | Bucket | Produced by |
|---|---|---|
| 1 | Background colors | `bgcolor()` |
| 2 | Fills | `fill()` (all three overloads) |
| 3 | Plots | `plot()`, `plotshape()`, `plotchar()`, `plotarrow()`, `plotcandle()`, `plotbar()` |
| 4 | Horizontal levels | `hline()` |
| 5 | Linefills | `linefill.new()` |
| 6 | Lines | `line.new()` |
| 7 | Boxes | `box.new()` |
| 8 | Labels | `label.new()` |
| 9 | **Tables** | `table.new()` + `table.cell()` — always on top |

`[UM]` verbatim: *"Pine elements are divided into z-index groups based on their visual type. Each
group has its own position in the z-space, and **within the same group, elements created last in the
script's logic appear on top** of other elements from the same group."*

And the hard constraint: *"An element **cannot be placed outside the region of z-space that its group
occupies** — for example, a plot can never appear on top of a table, because tables have the highest
z-index."*

Consequences a renderer must encode:

- **Fills sit above plots.** This is why `[UM]` advises keeping fill transparency at 70–90: *"fills
  have a higher z-index than plots, so they are placed on top of them"*.
- **Multiple `bgcolor()` calls: the last one wins** (drawn on top; earlier ones show through only via
  transparency).
- **`barcolor()` is not in the list at all.** It recolours *the chart's* bars rather than drawing in
  the script's visual space, so it does not compete with a script's own `plotcandle()`/`plotbar()`
  output. Its precedence against a `plotcandle()` overlay, and the result of two `barcolor()` calls
  on one bar, are UNVERIFIED (§8).

### 2.2 What `explicit_plot_zorder` does — and does not — govern

`indicator(explicit_plot_zorder = …)`, `const bool`, **default `false`**. Reference verbatim:

> "Specifies which rules the script uses to determine the visual order of **plots from `plot*()`
> calls, levels from `hline()` calls, and fills from `fill()` calls** on the chart. If `true`, the
> indicator displays these visuals **in the order of their function calls in the code**. If `false`,
> the script uses the default z-index rules to determine the order of the visuals. The default is
> `false`."

`[UM]` states the same thing as the *sole* exception to the bucket rule: programmers can arrange
`plot*()`, `hline()` and `fill()` visuals *"(and only these types of visuals)"* in source order.
`[RN]` July 2021, at introduction: *"each newer plot being drawn above the previous ones."*

| `explicit_plot_zorder = true` | |
|---|---|
| **DOES** | collapse buckets **2 (fills)**, **3 (plots)** and **4 (horizontal levels)** into one sequence ordered by source-call order |
| **DOES NOT** | touch bucket 1 (backgrounds), 5 (linefills), 6 (lines), 7 (boxes), 8 (labels) or 9 (tables) |
| **DOES NOT** | move any Pine visual relative to the chart's own candles — that is `behind_chart` |
| **DOES NOT** | let anything above a table. Tables are never reorderable by any mechanism. |

### 2.3 What `behind_chart` does

`indicator(behind_chart = …)`, `const bool`, **default `true`**. Reference verbatim:

> "Controls whether **all plots and drawings** appear **behind the chart display** (if `true`) or **in
> front of it** (if `false`). **This parameter takes effect only when the `overlay` argument is
> `true`.** Changes to the argument apply only after the user adds the script to the chart again. The
> default is `true`."

`behind_chart` is **orthogonal** to the nine buckets. It moves the script's *entire* visual stack as
one unit relative to the chart's own candle/bar rendering; the buckets order Pine visuals among
themselves. A renderer needs both axes: an inter-layer flag (script stack vs. chart series) and the
intra-script bucket order.

Note the default is the surprising one — an overlay script's visuals sit **behind** the candles
unless the author passes `behind_chart = false`. Introduced October 2024 `[RN]`, so v5 and v6.
`[UM]` records that the user-facing equivalent is *"Visual Order/Bring to Front"* in the script's
"More" menu.

### 2.4 Pane routing is a third, separate axis

Neither z-order mechanism decides *which pane* a visual lands in. That is:

- `indicator(overlay = …)` — script-wide, `const bool`, default `false` (separate pane).
- `force_overlay = true` — per-call override, `const bool`, default `false`, promoting **one** output
  to the main chart pane. Accepted by exactly **12** functions (§4.8.3). It has no inverse: nothing
  can push a visual from the main pane into a separate pane per call.

---

## 3. The object limit model

### 3.1 The table

| Object type | Declaration param | Default | Maximum | Eviction rule | Counts toward quota |
|---|---|---|---|---|---|
| `line` | `max_lines_count` | **~50** ⚠approx | **500** `[UM]`/`strategy()` | oldest-first automatic deletion ("garbage collection"), silent, no error | every allocated ID: incl. `na` coordinates, zero-length lines, `line.copy()` results |
| `label` | `max_labels_count` | **~50** ⚠approx | **500** `[UM]`/`strategy()` | same | same, incl. `label.copy()` |
| `box` | `max_boxes_count` | **~50** ⚠approx | **500** `[UM]`/`strategy()` | same | same, incl. `box.copy()` and zero-area boxes |
| `polyline` | `max_polylines_count` | **~50** ⚠approx | **100** `[UM]`/`strategy()` | same | **one ID per polyline regardless of point count** (10,000 points = 1 slot) |
| `linefill` | *(none exists)* | — | **no documented cap** | tied to its two lines: deleting either line deletes the linefill | UNVERIFIED whether capped at all; implicitly bounded by line count (2 lines per linefill, 1 linefill per line pair) |
| `table` | *(none exists)* | — | **9 displayed**, one per `position.*` anchor | same-position collision: **newest wins, loser silently not rendered** (no error) | no `max_tables_count`; whether tables consume any drawing budget is UNVERIFIED |
| plot count | *(none)* | — | **64 per script** | runtime error, and the error message reports the script's actual plot count | see §3.4 |

**Every `max_*_count` parameter is `const int`** on `indicator()`/`strategy()`/`library()` — resolvable
at compile time, never driven by an `input.*` value.

### 3.2 The "~50 default is approximate" caveat — do not hard-assert

The reference repeats this for all four types, e.g. for boxes:

> "Determines the maximum number of box objects that remain available to the script. The system
> automatically deletes the oldest box objects when the number of boxes exceeds the limit. **The limit
> specified by the argument is approximate; the script might display more drawings than specified.**
> The default is **~50** boxes."

`[UM]`'s own worked example observes **54** labels displayed under the ~50 default.

⇒ A renderer must **not** assert `count <= max_*_count`, and must **not** assume exactly
`max_*_count` objects survive. Treat `max_*_count` as a *retention floor*, not a hard ceiling.

⚠ **Internal reference inconsistency, unresolved by the payload.** `indicator()` and `strategy()`
describe the same parameters differently:

| | `indicator()` (reference, verbatim) | `strategy()` (reference, verbatim) |
|---|---|---|
| lines / labels / boxes | "The default is ~50 …"; "the limit … is approximate" | "The number of last … drawings displayed. **Possible values: 1-500.** Optional. **The default is 50.**" — no approximate clause |
| polylines | "The default is ~50 polylines"; approximate | "**Possible values: 1-100. The count is approximate**; more drawings than the specified count may be displayed. The default is 50." |
| `max_bars_back` | "must be an integer **from 0 to 5000**"; auto-computed by default | "**The default is 0**"; no range stated |

Resolution adopted: **default ~50, settable 1–500 (1–100 for polylines), enforcement approximate.**
`[UM]`'s "54 labels" observation corroborates `indicator()`, not `strategy()`.

### 3.3 What counts toward the quota

All of these consume an ID:

1. **`na` coordinates.** `[UM]` verbatim: *"It's important to note when setting any of a drawing
   object's properties to `na` that **its ID still exists and thus contributes to a script's drawing
   totals**."* `[UM]`'s worked example creates two labels per bar, one always with `x = na`, under
   `max_labels_count = 10`, and *"the script displays fewer than 10 labels on the chart since the
   ones with `na` values also count toward the total."* The documented fix is to guard **creation**
   with `if`, not to `na` out properties.
2. **Zero-area / degenerate objects.** `[UM]`: identical `first_point`/`second_point` ⇒ *"the script
   will not display a line since there is no distance between them to draw. **However, the line ID
   will still exist.**"* Same sentence for a box with identical corners. `box.new(na, na, na, na, …)`
   is a documented idiom for a live-but-invisible box.
3. **`*.copy()` results.** `box.copy()`/`line.copy()`/`label.copy()` each clone into a **new
   independent object** — a new ID, a new quota slot. *"Any changes to the copied box do not affect
   the original."*

What frees a slot: `*.delete()`, which is **idempotent** — *"If it has already been deleted, does
nothing"* (`polyline.delete`: *"It has no effect if the `id` doesn't exist"*). No error on
double-delete.

**Eviction order is strict FIFO by creation.** Corroborated structurally by the `.all` arrays: every
one of `label.all`, `line.all`, `linefill.all`, `box.all`, `polyline.all`, `table.all` carries the
identical reference remark *"The array is **read-only**. Index zero of the array is the ID of the
**oldest** object on the chart."* **Index 0 is always the next victim** — which is why the documented
"keep only N" idiom is `label.delete(array.get(label.all, 0))`.

**Budgets are per-type and independent.** No source states an aggregate drawing-object budget; the
four caps are always presented separately, with separate `max_*_count` parameters and separate `.all`
arrays. A shared ceiling may exist in the engine but no number for one exists (§8).

Theoretical worst case a renderer must survive, derived arithmetically from the quoted caps:
500 lines + 500 boxes + 500 labels + (100 polylines × 10,000 points) = **1,000,000 polyline vertices
plus 1,500 other drawings**, per script instance.

### 3.4 Plot counts — a separate, independent budget

| Fact | Value |
|---|---|
| Maximum plot count per script | **64** |
| Maximum plot counts one call can generate | **7** |
| Overflow behaviour | runtime error; *"the runtime error message will display the plot count generated by your script"* |

**Generate plot counts** `[UM]`: `plot()`, `plotarrow()`, `plotbar()`, `plotcandle()`, `plotchar()`,
`plotshape()`, `alertcondition()`, `bgcolor()`, `barcolor()`, and `fill()` *"but only if its color is
of the `series` form."*

**Generate ZERO plot counts** `[UM]`: `hline()`, `line.new()`, `label.new()`, `table.new()`,
`box.new()`. Drawing objects and plots are budgeted on completely disjoint axes. Conversely, plots
have no per-bar cap: *"plots … can cover the chart's entire dataset."*

Per-call arithmetic — **one count per series-qualified output stream**. `[UM]`'s worked example totals
**56**:

| Call | Counts | Why |
|---|---|---|
| `plot(close, color = color.white)` | 1 | const colour |
| `plot(open, color = na)` | 1 | const colour |
| `plot(close, color = isUpColor)` | 2 | value + `color` |
| `plotarrow(close, colorup = color.green, colordown = color.red)` | 1 | both const |
| `plotarrow(close, colorup = isUpColor)` | 2 | value + `colorup` |
| `plotarrow(close - open, colorup = isUpColor, colordown = isDnColor)` | 3 | value + both colours |
| `plotbar(o,h,l,c, color = color.white)` | 4 | one per OHLC series |
| `plotbar(o,h,l,c, color = isUpColor)` | 5 | + `color` |
| `plotcandle(o,h,l,c, color/wickcolor/bordercolor all const)` | 4 | one per OHLC series |
| `plotcandle(…, color = series)` | 5 | + `color` |
| `plotcandle(…, color = series, wickcolor = series)` | 6 | + `wickcolor` |
| `plotcandle(…, color/wickcolor/bordercolor all series)` | **7** | documented maximum for one call |
| `plotchar(close, color = const, textcolor = const)` | 1 | |
| `plotchar(close, color = series)` | 2 | value + `color` |
| `plotchar(close, color = series, textcolor = series)` | 3 | value + both colours |
| `plotshape(close, …)` | 1 / 2 / 3 | same pattern as `plotchar` |
| `alertcondition(close > open, …)` | 1 | |
| `bgcolor(isUp ? color.yellow : color.white)` | 1 | |
| `fill(p1, p2, color = isUpColor)` | 1 | for the `color` series |

⚠ **Documented threshold conflict, unresolved.** For `plot()`, `[UM]` *Visuals / Plots* counts **2**
for `simple color`, `input color` **and** `series color`:

```
plot(close, color = syminfo.mintick > 0.0001 ? color.green : color.red) // simple color -> 2
plot(close, color = input.color(color.purple))                          // input color  -> 2
plot(close, color = close > open ? color.green : color.red)             // series color -> 2
plot(close, color = color.new(color.silver, close > open ? 40 : 0))     // series color -> 2
```

but for `fill()`, `[UM]` *Writing / Limitations* says the extra count applies *"only if its color is
of the **series** form."* Two different thresholds for the same idea. The four-example list is the
more specific statement and should win for `plot()`; the `fill()` sentence should be taken literally
for `fill()`. Neither statement is in the reference payload — plot-count arithmetic exists **only**
in `[UM]` prose (§8).

### 3.5 Adjacent limits a renderer is bound by

| Limit | Value | Source |
|---|---|---|
| `max_bars_back` parameter range | **0 to 5000** | reference, `indicator()` |
| Historical buffer ceiling, most series | **5000 bars** | `[UM]` |
| Historical buffer ceiling, `open`/`high`/`low`/`close`/`time` | **10,000 bars** | `[UM]` |
| Over-reference behaviour | **runtime error** | `[UM]` |
| Polyline maximum points | **10,000** ⇒ 9,999 segments open / 10,000 closed | `[UM]`, `[RN]` only |
| Backward x floor, `xloc.bar_index` | **`bar_index - 10000`** | `[UM]` only |
| Forward x ceiling, `xloc.bar_index` | **`bar_index + 500`** | reference (17 entries) + `[UM]` |
| Collection elements (array/matrix/map) | **100,000** | `[UM]` |
| Map key-value pairs | **50,000** | `[UM]` |
| Tables displayed per script | **9** | `[UM]` |
| Table columns / rows / total cells | **NO NUMBER DOCUMENTED** | — |
| `precision` ceiling | **16** | reference |
| `request.*()` unique calls | **40** standard / **64** Ultimate | `[UM]` |
| Tuple elements returned | **127** | `[UM]` |
| Variables per scope | **1,000** | `[UM]` |
| Script execution time | **20 s** basic / **40 s** others; loops **500 ms**/bar | `[UM]` |

⚠ **`max_bars_back` is a different axis from the x-coordinate clamp.** `bar_index - 10000` governs
where a drawing may be *placed*; `max_bars_back` governs how far back a *series value* may be *read*.
They must not be conflated.

⚠ **Provenance downgrade, verified.** The string "10,000"/"10000" appears **nowhere** in the
reference payload in connection with drawings — a full-payload search returns only
`initial_capital = 1000000` matches. Both the **polyline 10,000-point cap** and the **`bar_index -
10000` backward floor** are `[UM]`/`[RN]`-only. The 500/500/500/100 maxima likewise appear in
`strategy()` and `[UM]`, never in `indicator()`'s argument descriptions. Treat all three numbers as
documented but single-sourced.

---
## 4. The primitive families

### 4.0 How to read the parameter tables

Pine types are `<qualifier> <type>`, qualifier strength ascending **`const → input → simple →
series`**. A parameter documented `input int` accepts `const int` and `input int` but **rejects**
`simple`/`series`. A parameter documented `series color` accepts all four. `const` = known at compile
time; `input` = known after inputs resolve, before bar 0; `simple` = fixed for the run but may depend
on symbol/chart; `series` = may change per bar.

- **Qualified type** column = the reference's `displayType`. Where `allowedTypeIDs` is narrower or
  wider than `displayType` implies, the difference is called out in Notes — `allowedTypeIDs` is the
  authoritative gate.
- **Required** = the reference's own `required: true` flag. Absence of the flag means optional.
- **Default** = quoted from the argument's own `desc`. **"UNVERIFIED (none stated)" means the
  reference genuinely carries no default sentence for that argument** — the payload has no structured
  default field, so where prose is silent there is nothing to report. That is a real gap, not an
  omission in this document.

**Type-taxonomy traps that must be enforced in the tables, not just remembered** (from the payload's
own `type` fields):

| Trap | Consequence |
|---|---|
| `line.style_*` is `const string`; `hline.style_*` is **`const hline_style`** | `hline(linestyle = line.style_dashed)` is a **type error** even though both families name solid/dotted/dashed. `hline` has only 3 styles and no arrow styles. |
| `display.none`/`display.all` are **`const plot_simple_display`**; the other five are **`const plot_display`** | This is exactly why `fill()`, `hline()`, `bgcolor()`, `barcolor()` accept only the two-state form, and why the location-specific values are `plot*()`-only. |
| `plot.style_*` is `const plot_style`; `plot.linestyle_*` is `const plot_line_style` | Two independent style axes on `plot()`: 11 plot styles × 3 line styles. |
| `text.align_*`/`text.wrap_*` are `const string`; `text.format_*` is **`const text_format`** | Only `text_format` supports `+` composition. |
| `scale.*` = `const scale_type`, `hline.style_*` = `const hline_style`, `order.*` = `const sort_order` | Each is a closed nominal enum, not a string. |

---

### 4.1 Plot family — `plot`, `plotshape`, `plotchar`, `plotarrow`, `plotcandle`, `plotbar`

Six functions, **85 parameters total** (16 + 15 + 15 + 13 + 14 + 12). All six accept
`force_overlay`. Only `plot()` returns a value (`plot`, consumable by `fill()`); the other five return
`void` and **cannot** be filled.

#### 4.1.1 `plot()` — 16 parameters

```
plot(series, title, color, linewidth, style, trackprice, histbase, offset, join, editable,
     show_last, display, format, precision, force_overlay, linestyle) → plot
```

| # | Param | Qualified type | Req | Default | Notes |
|---|---|---|---|---|---|
| 1 | `series` | `series int/float` | **yes** | — | `allowedTypeIDs` covers all 4 qualifiers × {int, float}. **No `bool`** — auto-casting runs int→float→bool, so a bool must be converted (`cond ? 1 : 0`). Contrast `plotshape`/`plotchar`, which do accept `series bool`. |
| 2 | `title` | `const string` | no | UNVERIFIED (none stated) | const only |
| 3 | `color` | `series color` | no | UNVERIFIED (none stated) | accepts `#ff001a` literals and per-bar expressions |
| 4 | `linewidth` | `input int` | no | **`1`** | *"Not applicable to every style"* — see §4.1.7. v6: `linewidth < 1` is a compilation error |
| 5 | `style` | `input plot_style` | no | **`plot.style_line`** | 11 values, §4.1.7 |
| 6 | `trackprice` | `input bool` | no | **`false`** | |
| 7 | `histbase` | `input int/float` | no | **`0.0`** | reference scopes it to `style_histogram`, `style_columns`, `style_area` |
| 8 | `offset` | `simple int` | no | **`0`** | ⚠ **`series` is rejected in v6** (was `series int` in v5) |
| 9 | `join` | `input bool` | no | **`false`** | *"applicable only to `plot.style_cross` and `plot.style_circles`"* |
| 10 | `editable` | `input bool` | no | **`true`** | v5 had `const bool` |
| 11 | `show_last` | `input int` | no | all bars (none stated) | |
| 12 | `display` | `input plot_display` | no | **`display.all`** | accepts **both** `plot_display` and `plot_simple_display` IDs |
| 13 | `format` | `input string` | no | inherits declaration `format` | only `format.price`, `format.percent`, `format.volume` |
| 14 | `precision` | `input int` | no | inherits declaration `precision` | *"non-negative integer less than or equal to 16"* |
| 15 | `force_overlay` | **`const bool`** | no | **`false`** | const only — cannot vary |
| 16 | `linestyle` | `input plot_line_style` | no | **`plot.linestyle_solid`** | **new in v6**; v5 `plot()` had 15 params |

#### 4.1.2 `plotshape()` — 15 parameters

```
plotshape(series, title, style, location, color, offset, text, textcolor, editable, size,
          show_last, display, format, precision, force_overlay) → void
```

| # | Param | Qualified type | Req | Default | Notes |
|---|---|---|---|---|---|
| 1 | `series` | `series int/float/bool` | **yes** | — | *"treated as a series of **boolean** values for all `location` values **except** `location.absolute`"* |
| 2 | `title` | `const string` | no | UNVERIFIED | |
| 3 | `style` | `input string` | no | **`shape.xcross`** | 12 values |
| 4 | `location` | `input string` | no | **`location.abovebar`** | 5 values |
| 5 | `color` | `series color` | no | UNVERIFIED | `color = na` renders text with no visible shape |
| 6 | `offset` | `simple int` | no | **`0`** | v5: `series int` |
| 7 | `text` | **`const string`** | no | UNVERIFIED (empty implied) | ⚠ **const only** — one immutable string per call, resolvable at compile time |
| 8 | `textcolor` | `series color` | no | UNVERIFIED | |
| 9 | `editable` | `input bool` | no | **`true`** | |
| 10 | `size` | **`const string`** | no | **`size.auto`** | ⚠ const only; **no int accepted** (unlike labels/boxes/tables) |
| 11 | `show_last` | `input int` | no | all bars | |
| 12 | `display` | `input plot_display` | no | **`display.all`** | |
| 13 | `format` | `input string` | no | inherits | |
| 14 | `precision` | `input int` | no | inherits | |
| 15 | `force_overlay` | `const bool` | no | **`false`** | |

#### 4.1.3 `plotchar()` — 15 parameters

```
plotchar(series, title, char, location, color, offset, text, textcolor, editable, size,
         show_last, display, format, precision, force_overlay) → void
```

Identical to `plotshape()` except position 3 is `char` (`input string`, **no default stated in v6 or
v5** — the default glyph is UNVERIFIED). Note the asymmetry: `char` is `input string` while `text` is
`const string`, so `char` is the **looser** of the two and may be driven by `input.string()`.

Established about `char`: exactly **one Unicode character** — *"Plots visual shapes using any given
one Unicode character"*; `[UM]`: *"`plotchar()` can only display one character while `plotshape()` can
display strings, including line breaks."* Non-BMP works (`[UM]`'s own example uses U+1F807, two
UTF-16 code units) ⇒ **count codepoints, not `.length`**. `char = ""` is legal and renders the `text`
with no glyph above it.

#### 4.1.4 `plotarrow()` — 13 parameters

```
plotarrow(series, title, colorup, colordown, offset, minheight, maxheight, editable,
          show_last, display, format, precision, force_overlay) → void
```

| # | Param | Qualified type | Req | Default |
|---|---|---|---|---|
| 1 | `series` | `series int/float` | **yes** | — (**no `bool`**) |
| 2 | `title` | `const string` | no | UNVERIFIED |
| 3 | `colorup` | `series color` | no | UNVERIFIED |
| 4 | `colordown` | `series color` | no | UNVERIFIED |
| 5 | `offset` | `simple int` | no | **`0`** |
| 6 | `minheight` | `input int` | no | **`5`** (pixels) |
| 7 | `maxheight` | `input int` | no | **`100`** (pixels) |
| 8 | `editable` | `input bool` | no | **`true`** |
| 9 | `show_last` | `input int` | no | all bars |
| 10 | `display` | `input plot_display` | no | **`display.all`** |
| 11 | `format` | `input string` | no | inherits |
| 12 | `precision` | `input int` | no | inherits |
| 13 | `force_overlay` | `const bool` | no | **`false`** |

No `location`, no `text`, no `size`, no `style`. Reference: *"Up arrow is drawn at every indicator
**positive** value, down arrow at every **negative** value. If indicator returns `na` then **no arrow
is drawn**. Arrows has different height, the more absolute indicator value the longer arrow is
drawn."* `[UM]` adds `series == 0` ⇒ **no arrow**, and that length is *"proportional to the relative
value of the series on that bar in relation to other series values"*, bounded to
`[minheight, maxheight]` **in pixels**.

#### 4.1.5 `plotcandle()` — 14 parameters

```
plotcandle(open, high, low, close, title, color, wickcolor, editable, show_last,
           bordercolor, display, format, precision, force_overlay) → void
```

⚠ Note the ordering: **`bordercolor` sits after `show_last`**, not beside `wickcolor`.

| # | Param | Qualified type | Req | Default | Notes |
|---|---|---|---|---|---|
| 1–4 | `open`, `high`, `low`, `close` | `series int/float` | **yes** ×4 | — | atomic four-tuple, §4.1.9 |
| 5 | `title` | `const string` | no | UNVERIFIED | |
| 6 | `color` | `series color` | no | UNVERIFIED | body fill |
| 7 | `wickcolor` | `series color` | no | UNVERIFIED | wicks |
| 8 | `editable` | `input bool` | no | **`true`** | |
| 9 | `show_last` | `input int` | no | all bars | |
| 10 | `bordercolor` | `series color` | no | UNVERIFIED | body border |
| 11 | `display` | `input plot_display` | no | **`display.all`** | |
| 12 | `format` | `input string` | no | inherits | |
| 13 | `precision` | `input int` | no | inherits | |
| 14 | `force_overlay` | `const bool` | no | **`false`** | |

#### 4.1.6 `plotbar()` — 12 parameters

```
plotbar(open, high, low, close, title, color, editable, show_last, display, format,
        precision, force_overlay) → void
```

Same as `plotcandle()` minus `wickcolor` and `bordercolor`: `[UM]` — *"`plotbar()` has **no parameter
for `bordercolor` or `wickcolor`**, as there are no borders or wicks on conventional bars."* A single
`color` paints the whole OHLC bar (left open tick, right close tick, vertical range). Carries the same
two remarks as `plotcandle()` verbatim.

#### 4.1.7 `style` semantics — `na`, `linewidth` meaning, y-scale contribution

| `style` constant | Display name | `na` behaviour | What `linewidth` means | y-scale |
|---|---|---|---|---|
| `plot.style_line` *(default)* | Line | **bridges** — joins most recent non-`na` to next non-`na` | **pixels** | plotted values |
| `plot.style_linebr` | Line With Breaks | **breaks**, gaps not joined | pixels | plotted values |
| `plot.style_stepline` | Step Line | **bridges** (staircase continues) | pixels | plotted values |
| `plot.style_stepline_diamond` | Step Line With Diamonds | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| `plot.style_steplinebr` | Step line with Breaks | UNVERIFIED beyond the name | UNVERIFIED | UNVERIFIED |
| `plot.style_area` | Area | **bridges** | pixels; `color` paints **both** line and fill | plotted values |
| `plot.style_areabr` | Area With Breaks | **breaks** | pixels | **only plotted values** — does *not* force `histbase` in |
| `plot.style_columns` | Columns | UNVERIFIED | **nothing at all** — *"does not affect the width of the columns"* | **always includes `histbase`** |
| `plot.style_histogram` | Histogram | UNVERIFIED | **bar width in pixels**; `input int` ⇒ cannot vary per bar | **always includes `histbase`** |
| `plot.style_circles` | Circles | discrete marks | **relative size — "its units are not pixels"** | plotted values |
| `plot.style_cross` | Cross | discrete marks | **relative, not pixels** | plotted values |

`linewidth` therefore has **three different meanings**: pixels, a unitless relative size, and nothing.
A single pixel-width code path silently mis-renders four of eleven styles.

`histbase` is the zero-crossing reference for area/columns/histogram: *"Positive values are plotted
above the `histbase`, negative values below it."* It is `input`, so it can never move during execution.

`join = true` affects **only** `circles` and `cross`, and the joining line is fixed at **1 pixel**,
not `linewidth`.

`linestyle` applies **only** when `style` ∈ {`style_line`, `style_linebr`, `style_stepline`,
`style_stepline_diamond`, `style_area`} — reference verbatim. Ignored for columns, histogram, circles,
cross, and (per that list) `steplinebr`.

#### 4.1.8 `location` — and which locations feed the y-scale

| Constant | Placement (reference verbatim) | y from series value? |
|---|---|---|
| `location.abovebar` *(default)* | "Shape is plotted **above main series bars**." | no — bool test. `[UM]`: it **does** put the value into the script's scale |
| `location.belowbar` | "Shape is plotted **below main series bars**." | no — bool test |
| `location.top` | "Shape is plotted **near the top chart border**." | no; `[UM]` uses it precisely so the value does **not** enter the scale |
| `location.bottom` | "Shape is plotted **near the bottom chart border**." | no |
| `location.absolute` | "Shape is plotted on chart **using indicator value as a price coordinate**." | **YES** — the value *is* y; `na` ⇒ nothing drawn |

Gating for all non-absolute locations: `[UM]` — these functions *"show visuals on the chart **only when
the series value is not `na` or 0**."* So `0` and `false` both suppress the mark.

#### 4.1.9 The two `plotcandle`/`plotbar` remarks — quoted, because they are easy to get wrong

Reference remarks, identical on both functions:

> "**Even if one value of `open`, `high`, `low` or `close` equal NaN then bar no draw. The maximal
> value of `open`, `high`, `low` or `close` will be set as 'high', and the minimal value will be set as
> 'low'.**"

1. **Atomic `na`.** Any one of the four `na` ⇒ the entire bar is skipped. No partial render, no
   body-without-wick, no gap-fill, no carry-forward. `[UM]`'s HTF example relies on this exactly:
   `plotcandle(timeframe.isintraday ? o : na, h, l, c, …)` uses an `na` **`open`** as the switch.
2. **High and low are re-derived.** The renderer must compute `hi = max(o,h,l,c)` and
   `lo = min(o,h,l,c)` and draw the wick between *those*, not between the passed `high` and `low`.
   A deliberately inverted `high`/`low` produces a well-formed candle, not a defect.

#### 4.1.10 `offset`, `show_last`, `display`, `trackprice`

- **`offset`** is a pure x-axis placement shift of already-computed values: the value calculated on bar
  *N* is drawn at bar *N + offset*. Nothing in any source describes it altering the series, the `[]`
  operator, or calculation order. `simple int` in v6 ⇒ cannot change bar to bar.
- **`show_last` na-masks, it does not clip.** `[UM]`: *"Controls the number of bars on which the plot
  values are visible, **counting backward from the last bar**. **Bars beyond the specified amount show
  `na` values for this plot.**"* Inclusive of the last bar (`show_last = 1` ⇒ exactly one bar). Because
  the mechanism is masking, a bridging style **must not** draw a connector from the masked region into
  the visible region.
- **`display` is set arithmetic over a permission set.** `+` and `-` compose flags
  (`display.all - display.pane`, `display.price_scale + display.status_line`). Repeated subtraction of
  the same flag is **idempotent and non-erroring** `[UM]` ⇒ implement as set arithmetic, not integer
  arithmetic. `display.none` = calculate but display nowhere **and contribute nothing to the scale**.
  A flag is a *permission*, not a guarantee: reference — *"the relevant plot information will only
  appear **when all settings allow for it**."*
- **`trackprice = true`** draws a dotted line of small squares *"the full width of the script's visual
  space"* at the level of the last indicator value, independent of the plot line. Documented idiom:
  `trackprice = true, show_last = 1, offset = -99999` — one bar, pushed off the dataset, leaving only
  the ruler.
- **Numeric readouts** `[UM]`: status line and Data Window show the values *at the pointer's bar*, or
  the latest bar when the pointer is off-chart. Price-scale labels show *"the latest non-`na` values
  available in the plotted series **up to the last visible bar**"*, and **no label at all** if there is
  no non-`na` value before that bar. `plotshape()`, `plotchar()` and `plotarrow()` **never write to the
  price scale**.

#### 4.1.11 Structural rules

- A `plot*()` call **must be in the script's global scope** — never inside `if`, `for`, or a
  user-defined function body. Conditional plotting is done by plotting `na`, or an `na`/100-transparency
  colour.
- Within the plots bucket, draw order follows **order of appearance in the script**.
- `format.inherit` is **not** a valid `plot*()` `format` argument (declaration-level only), and
  `format.mintick` is `str.tostring()`-only. The plot-level set is exactly
  {`format.price`, `format.percent`, `format.volume`}.
- `precision` is **inert under `format.volume`** — volume's own precision rules supersede it.

#### 4.1.12 Renderer must reproduce

- **C1.** `plot()` accepts 16 named parameters in the order given; `plotshape()`/`plotchar()` 15,
   `plotarrow()` 13, `plotcandle()` 14, `plotbar()` 12 — positional calls must bind in that order.
- **C2.** `plot()` returns a fillable `plot` id; the other five return `void` and are rejected by `fill()`.
- **C3.** `plot(style = plot.style_line)` bridges `na` gaps; `plot.style_linebr` and `plot.style_areabr` do
   not.
- **C4.** `plot.style_columns` ignores `linewidth` entirely; `plot.style_circles`/`_cross` treat it as a
   unitless relative size; the line/area/histogram styles treat it as pixels.
- **C5.** `plot.style_columns` and `plot.style_histogram` force `histbase` into the pane's y-range;
   `plot.style_areabr` computes the range from plotted values only.
- **C6.** `linestyle` is honoured for exactly the five styles the reference lists and ignored for the other
   six.
- **C7.** `join = true` draws a 1-pixel connector for circles/cross only, regardless of `linewidth`.
- **C8.** `plotshape`/`plotchar` with any `location` other than `location.absolute` treat `series` as a
   truth test (`not na and != 0`) and take y from the location constant; with `location.absolute` the
   value is the y coordinate and `na` suppresses the mark.
- **C9.** `location.abovebar`/`belowbar`/`absolute` feed the series value into the pane's y-range;
   `location.top`/`bottom` do not.
- **C10.** `plotshape(text=)`, `plotshape(size=)`, `plotchar(text=)`, `plotchar(size=)` accept **const
  strings only** and are resolved once at compile time; a series or input argument is a type error.
- **C11.** `plotchar(char=)` accepts exactly one Unicode codepoint (non-BMP included) or `""`; `""` renders
  `text` with no glyph.
- **C12.** `plotshape`/`plotchar` `text` splits on `\n`; a trailing `\n` lifts text away from the bar and a
  leading `\n` pushes it away downward.
- **C13.** `plotarrow` draws up for `series > 0`, down for `series < 0`, and **nothing** for `0` or `na`.
- **C14.** `plotarrow` arrow length is clamped into `[minheight, maxheight]` pixels, defaults 5 and 100.
- **C15.** `plotcandle`/`plotbar` skip the entire bar if **any** of `open`/`high`/`low`/`close` is `na`.
- **C16.** `plotcandle`/`plotbar` draw the wick/range between `max(o,h,l,c)` and `min(o,h,l,c)`, not between
  the passed `high` and `low`.
- **C17.** `plotcandle` paints body, wick and border from three independent `series color` channels;
  `plotbar` from one.
- **C18.** `show_last = N` makes bars older than the last N read as `na` for that plot (not clipped), and no
  bridge crosses the boundary.
- **C19.** `offset = k` draws bar *N*'s computed value at bar *N + k* without altering the series.
- **C20.** `plot(offset = <series>)` is a **compile error** in v6 (`simple int` gate); it was legal in v5.
- **C21.** `plot(linewidth = 0)` is a **compile error** in v6; it was legal in v5 and must still render on
  the v≤5 path.
- **C22.** `display.all - display.pane - display.pane` equals `display.all - display.pane` — no error, no
  double subtraction.
- **C23.** `display.none` removes the plot from the pane, the status line, the Data Window **and the scale**,
  while its values remain readable by `input.source()` and by `{{plot("title")}}` in
  `alertcondition()`.
- **C24.** `plotshape`, `plotchar` and `plotarrow` write nothing to the price scale even when
  `display.price_scale` is set.
- **C25.** A per-call `format`/`precision` overrides the declaration's; `format.volume` overrides
  `precision` in either position.
- **C26.** `precision > 16` is rejected.
- **C27.** A `plot*()` call inside `if`/`for`/a function body is a compile error.
- **C28.** Within the plots bucket, later calls paint over earlier ones.

---

### 4.2 Fills, backgrounds and colour — `fill`, `hline`, `bgcolor`, `barcolor`, `color.*`

#### 4.2.1 `fill()` — three overloads

`fill()` is the only built-in that consumes `plot` and `hline` ids. **No overload has
`force_overlay`** — a fill lives wherever its plots live. Overload order below is the payload's own
enumeration order.

**Overload 1 — vertical gradient (10 params).** ⚠ Note: no `color`, no `show_last`, and the tail order
is `title, display, fillgaps, editable`.

```
fill(plot1, plot2, top_value, bottom_value, top_color, bottom_color, title, display,
     fillgaps, editable) → void
```

| # | Param | Qualified type | Req | Default |
|---|---|---|---|---|
| 1 | `plot1` | `plot` | **yes** | — |
| 2 | `plot2` | `plot` | **yes** | — |
| 3 | `top_value` | `series int/float` | no* | UNVERIFIED |
| 4 | `bottom_value` | `series int/float` | no* | UNVERIFIED |
| 5 | `top_color` | `series color` | no* | UNVERIFIED |
| 6 | `bottom_color` | `series color` | no* | UNVERIFIED |
| 7 | `title` | `const string` | no | UNVERIFIED |
| 8 | `display` | `input plot_simple_display` | no | **`display.all`** |
| 9 | `fillgaps` | `const bool` | no | **`false`** |
| 10 | `editable` | `input bool` | no | **`true`** |

\* the reference flags only `plot1`/`plot2` as required; in practice all four gradient arguments must
be supplied together for overload resolution to select this form.

**Overload 2 — solid fill between two hlines (7 params).**

```
fill(hline1, hline2, color, title, editable, fillgaps, display) → void
```

| # | Param | Qualified type | Req | Default |
|---|---|---|---|---|
| 1 | `hline1` | `hline` | **yes** | — |
| 2 | `hline2` | `hline` | **yes** | — |
| 3 | `color` | `series color` | no | UNVERIFIED |
| 4 | `title` | `const string` | no | UNVERIFIED |
| 5 | `editable` | `input bool` | no | **`true`** |
| 6 | `fillgaps` | `const bool` | no | **`false`** |
| 7 | `display` | `input plot_simple_display` | no | **`display.all`** |

**Overload 3 — solid fill between two plots (8 params).** The only overload with `show_last`.

```
fill(plot1, plot2, color, title, editable, show_last, fillgaps, display) → void
```

| # | Param | Qualified type | Req | Default |
|---|---|---|---|---|
| 1 | `plot1` | `plot` | **yes** | — |
| 2 | `plot2` | `plot` | **yes** | — |
| 3 | `color` | `series color` | no | UNVERIFIED |
| 4 | `title` | `const string` | no | UNVERIFIED |
| 5 | `editable` | `input bool` | no | **`true`** |
| 6 | `show_last` | `input int` | no | UNVERIFIED (omitted ⇒ all bars) |
| 7 | `fillgaps` | `const bool` | no | **`false`** |
| 8 | `display` | `input plot_simple_display` | no | **`display.all`** |

Behaviour:

- **`fillgaps`** (reference verbatim): *"Controls continuing fills on gaps, i.e., when one of the
  `plot()` calls returns an `na` value. When true, the last fill will continue on gaps. The default is
  false."* So `na` in either bounding plot **breaks** the fill by default and **holds** it when
  `fillgaps = true`. It never interpolates.
- **Plot ids and hline ids may never be mixed in one call** `[UM]`: *"One cannot mix and match these
  types."* The documented workaround is `plot(<constant>)` instead of `hline()`.
- **`display` on the bounding plots does not disable the fill.** `[UM]` fills between plots declared
  `display = display.none` and `display = display.data_window`, and between hlines whose own colour is
  `color(na)`.
- **The gradient is a price-space ramp that the plot pair masks** `[BLOG]`: *"They create a vertical
  gradient between the `top_color` and the `bottom_color` in the space between the `top_value` and the
  `bottom_value`. The plots or hlines which IDs are used in the first two arguments **act as a mask over
  the gradient**, determining which portion of the gradient is visible."*

⚠ **Resolved conflict — the gradient overload must accept hlines.** The payload types the gradient
overload's first two parameters as `plot`, and contains **no** hline-gradient overload. But the
reference's **own example** for `fill()` is titled *"Gradient fill between two horizontal lines"* and
passes two `hline()` results; `[BLOG]` declares two gradient overloads including
`fill(hline1, hline2, top_value, bottom_value, top_color, bottom_color)`; and `[UM FAQ]` ships
`fill(h2, h1, 30, 5, color.new(obFillColor, 80), color(na))` over `hline()` ids. ⇒ **Accept
`(hline, hline, num, num, color, color)`.** The single-`plot` typing is a documentation defect in the
payload, not the language rule.

#### 4.2.2 `hline()` — 7 parameters

```
hline(price, title, color, linestyle, linewidth, editable, display) → hline
```

Returns an `hline` id whose **only** consumer is `fill()`. No `force_overlay`.

| # | Param | Qualified type | Req | Default | Notes |
|---|---|---|---|---|---|
| 1 | `price` | `input int/float` | **yes** | — | ⚠ **no `series`** — `close` or any per-bar value is a type error |
| 2 | `title` | `const string` | no | UNVERIFIED | |
| 3 | `color` | `input color` | no | UNVERIFIED (none stated) | reference: *"**Must be a constant value (not an expression).**"* |
| 4 | `linestyle` | **`input hline_style`** | no | UNVERIFIED (none stated) | only `hline.style_solid`, `hline.style_dotted`, `hline.style_dashed` — **not** `line.style_*` |
| 5 | `linewidth` | `input int` | no | **`1`** | |
| 6 | `editable` | `input bool` | no | **`true`** | |
| 7 | `display` | `input plot_simple_display` | no | **`display.all`** | two-state only |

Toggling an hline is input-only: `price = show ? 70 : na`, `color = show ? c : color(na)`, or
`display = show ? display.all : display.none` `[UM FAQ]`.

#### 4.2.3 `bgcolor()` — 7 parameters, and `barcolor()` — 6

```
bgcolor(color, offset, editable, show_last, title, display, force_overlay) → void
barcolor(color, offset, editable, show_last, title, display) → void
```

Parameters 1–6 are **identical**; the difference is that **`bgcolor()` has `force_overlay` and
`barcolor()` does not**.

| # | Param | Qualified type | Req | Default |
|---|---|---|---|---|
| 1 | `color` | `series color` | **yes** | — |
| 2 | `offset` | `simple int` | no | **`0`** |
| 3 | `editable` | `input bool` | no | **`true`** |
| 4 | `show_last` | `input int` | no | UNVERIFIED (omitted ⇒ all bars) |
| 5 | `title` | `const string` | no | UNVERIFIED |
| 6 | `display` | `input plot_simple_display` | no | **`display.all`** |
| 7 | `force_overlay` *(bgcolor only)* | `const bool` | no | **`false`** |

`barcolor()` does not need `force_overlay` because of the one documented exception to "a script can
only colour the elements in its own visual space" `[UM]`:

> "The `barcolor()` function colors bars on the main chart, **regardless of whether the script is
> running in the main chart pane or a separate pane**."

`na` semantics `[UM]`: *"The `na` value leaves bars as is."* Single-bar colouring is the documented
idiom, achieved with `na` on every other bar — `bgcolor(bar_index % 10 == 0 ? chart.fg_color : na)`,
*"it is always exactly one bar wide"*. `offset` translates the whole colour series; it cannot target a
different bar than the executing one: *"Scripts can change background color only on the bar on which
the script is currently executing; offsetting the change is not possible."*

#### 4.2.4 Colour functions

```
color.new(color, transp)                                       → const|input|simple|series color
color.rgb(red, green, blue, transp)                            → const|input|simple|series color
color.from_gradient(value, bottom_value, top_value, bottom_color, top_color) → series color
color.r(color) / color.g(color) / color.b(color) / color.t(color)            → …float
color(x)                                                       → …color   // cast; color(na) idiom
```

- **`color.new`** — both args required, 4 qualifier overloads; the return qualifier is the strongest
  qualifier among the inputs. `transp`: *"Possible values are from 0 (not transparent) to 100
  (invisible)."*
- **`color.rgb`** — `red`/`green`/`blue` required (0–255), `transp` optional, **default `0`** (opaque).
  4 qualifier overloads.
- **`color.from_gradient`** — all five required, **always returns `series color`** regardless of input
  qualifiers. Reference: *"Based on the relative position of `value` in the `bottom_value` to
  `top_value` range, the function returns a color from the gradient defined by `bottom_color` to
  `top_color`."* `[UM]`: interpolation is linear across **all RGBA components**; out-of-range values
  **hard clamp** to the endpoint colours — no extrapolation, no `na`. `na` is a legal endpoint colour.
- ⚠ **Argument-order trap.** `color.from_gradient(value, **bottom_value, top_value, bottom_color,
  top_color**)` is bottom-first; `fill()`'s gradient overload is `(…, **top_value, bottom_value,
  top_color, bottom_color**)`, top-first. Opposite conventions in adjacent APIs.
- **Transparency is one scale, `0`–`100`**, `0` opaque → `100` invisible, and it may be a **float**,
  reaching all 256 underlying alpha values. Hex `#RRGGBBAA` uses the **reversed** `00`–`FF` opacity
  scale (`…40` ≙ transparency 75). The **`transp=` *parameter*** of the plotting functions was
  deprecated in v5 and **does not exist in v6**; in v6 `transp` survives only as an argument of
  `color.new()` and `color.rgb()`.

#### 4.2.5 The 17 `color.*` constants — hexes verified against the payload

All are `const color`. `color.*` also holds the 7 functions above ⇒ 24 `color.*` identifiers, 17 of
them constants.

| Constant | Hex (reference) | `color.rgb()` equivalent |
|---|---|---|
| `color.aqua` | `#00BCD4` | `color.rgb(0, 188, 212)` |
| `color.black` | `#363A45` | `color.rgb(54, 58, 69)` |
| `color.blue` | **`#2962ff`** | — |
| `color.fuchsia` | `#E040FB` | `color.rgb(224, 64, 251)` |
| `color.gray` | `#787B86` | `color.rgb(120, 123, 134)` |
| `color.green` | `#4CAF50` | `color.rgb(76, 175, 80)` |
| `color.lime` | `#00E676` | `color.rgb(0, 230, 118)` |
| `color.maroon` | `#880E4F` | `color.rgb(136, 14, 79)` |
| `color.navy` | `#311B92` | `color.rgb(49, 27, 146)` |
| `color.olive` | `#808000` | `color.rgb(128, 128, 0)` |
| `color.orange` | `#FF9800` | `color.rgb(255, 152, 0)` |
| `color.purple` | `#9C27B0` | `color.rgb(156, 39, 176)` |
| `color.red` | `#F23645` | `color.rgb(242, 54, 69)` |
| `color.silver` | `#B2B5BE` | `color.rgb(178, 181, 190)` |
| `color.teal` | `#089981` | `color.rgb(8, 153, 129)` |
| `color.white` | `#FFFFFF` | `color.rgb(255, 255, 255)` |
| `color.yellow` | `#FDD835` | `color.rgb(253, 216, 53)` |

⚠ **Resolved conflict: `color.blue` is `#2962ff`, not `#2196F3`.** The v6 payload and the v5 payload
both carry `#2962ff`; `#2196F3` (Material Blue 500) appears only in `[UM]`'s prose table. Note the
payload's lowercase hex for this one constant — a renderer must compare case-insensitively.

#### 4.2.6 Renderer must reproduce

- **C29.** `fill()` resolves three overloads by shape: `(plot, plot, num, num, color, color, …)` gradient,
  `(hline, hline, color, …)` solid, `(plot, plot, color, …)` solid — with the exact parameter orders
  above, which differ between overloads.
- **C30.** The gradient overload also accepts two `hline` ids (documented defect notwithstanding).
- **C31.** Mixing a `plot` id and an `hline` id in one `fill()` call is an error.
- **C32.** `fill()` on a bar where either bounding plot is `na` draws nothing when `fillgaps = false`, and
  continues the previous fill when `fillgaps = true`. It never interpolates.
- **C33.** `fill()` renders even when both bounding plots are `display.none`.
- **C34.** No `fill()` overload accepts `force_overlay`; the fill inherits its plots' pane.
- **C35.** The gradient is a ramp in **price space** between `top_value` and `bottom_value`, recomputed per
  bar (all four gradient args are series-capable), clipped by the plot pair acting as a mask.
- **C36.** Fills paint **above** plots (bucket 2 vs 3) unless `explicit_plot_zorder = true`.
- **C37.** `hline(price = <series>)` is a compile error; `hline(color = <expression>)` is a compile error.
- **C38.** `hline(linestyle = line.style_dashed)` is a **type error** — `hline_style` and the `line.style_*`
  strings are different types; `hline` has exactly 3 styles.
- **C39.** `fill()`, `hline()`, `bgcolor()`, `barcolor()` accept only `display.none` and `display.all`; any
  `plot_display` member is a type error.
- **C40.** `bgcolor()` accepts `force_overlay`; `barcolor()` does not.
- **C41.** `barcolor()` colours bars on the **main chart** even when the script occupies a separate pane.
- **C42.** `bgcolor(na)` / `barcolor(na)` leave that bar untouched; a single non-`na` bar renders as an
  exactly-one-bar-wide vertical band.
- **C43.** Multiple `bgcolor()` calls: the last call in source order paints on top.
- **C44.** `color.new(c, t)` and `color.rgb(r, g, b, t)` treat `t` as 0 = opaque … 100 = invisible, accept
  float `t`, and `color.rgb`'s `t` defaults to 0.
- **C45.** `color.rgb` returns the qualifier-matched overload; `color.from_gradient` always returns
  `series color`.
- **C46.** `color.from_gradient` interpolates linearly across all RGBA components and **clamps** outside
  `[bottom_value, top_value]`.
- **C47.** `color.blue` renders `#2962ff`.
- **C48.** `transp=` as a parameter of any plotting function is a compile error in v6.

---
### 4.3 Labels — `label.*`

**Surface: 21 functions (`label.new` has 2 overloads ⇒ 22 payload entries) + 1 variable `label.all`.**
20 of the 21 also exist in method form — every function **except** the `label.new` constructors.

#### 4.3.1 `label.new()` — two overloads

```
label.new(point, text, xloc, yloc, color, style, textcolor, size, textalign, tooltip,
          text_font_family, force_overlay, text_formatting) → series label            // 13 params

label.new(x, y, text, xloc, yloc, color, style, textcolor, size, textalign, tooltip,
          text_font_family, force_overlay, text_formatting) → series label            // 14 params
```

| Param | Qualified type | Req | Default | Notes |
|---|---|---|---|---|
| `point` | `chart.point` | **yes** (ov. 1) | — | values are **copied** at construction |
| `x` | `series int` | **yes** (ov. 2) | — | bar index or UNIX ms per `xloc`; *"cannot be drawn further than 500 bars into the future"* |
| `y` | `series int/float` | **yes** (ov. 2) | — | *"**taken into account only if `yloc = yloc.price`**"* |
| `text` | `series string` | no | **`""`** | |
| `xloc` | `series string` | no | **`xloc.bar_index`** | 2 values |
| `yloc` | `series string` | no | **`yloc.price`** | 3 values |
| `color` | `series color` | no | **UNVERIFIED (none stated)** | *"Color of the label border and arrow"* — the balloon/marker, **not** the text |
| `style` | `series string` | no | **`label.style_label_down`** | **21** values |
| `textcolor` | `series color` | no | **UNVERIFIED (none stated)** | v6 renders white by default, v5 black — §5.6 |
| `size` | `series int/string` | no | **`size.normal` (= 12)** | positive int (typographic points) **or** a `size.*` constant |
| `textalign` | `series string` | no | **`text.align_center`** | only left/center/right — **3 of the 5** `text.align_*` |
| `tooltip` | `series string` | no | **UNVERIFIED (none stated)** | hover text; no styling parameters exist |
| `text_font_family` | `series string` | no | **`font.family_default`** | only `font.family_default`, `font.family_monospace` |
| `force_overlay` | **`const bool`** | no | **`false`** | the **only** non-series parameter |
| `text_formatting` | `series text_format` | no | **`text.format_none`** | additive: `text.format_bold + text.format_italic` |

Reference verbatim for `size`: *"Accepts a positive int value or one of the built-in `size.*`
constants. The constants and their equivalent numeric sizes are: `size.auto` (0), `size.tiny` (~7),
`size.small` (~10), `size.normal` (12), `size.large` (18), `size.huge` (24). The default value is
`size.normal`, which represents the numeric size of 12."*

⚠ **Two different int tables exist and must not be crossed.** Labels: 0 / ~7 / ~10 / **12** / 18 / 24.
Boxes and tables: 0 / 8 / 10 / **14** / 20 / 36. `plotshape`/`plotchar` accept **no int at all**. The
`~` on tiny/small is TradingView's own.

#### 4.3.2 The 21 `label.style_*` values

```
label.style_none            label.style_xcross          label.style_cross
label.style_triangleup      label.style_triangledown    label.style_flag
label.style_circle          label.style_arrowup         label.style_arrowdown
label.style_label_up        label.style_label_down      label.style_label_left
label.style_label_right     label.style_label_lower_left  label.style_label_lower_right
label.style_label_upper_left  label.style_label_upper_right  label.style_label_center
label.style_square          label.style_diamond         label.style_text_outline
```

All `const string`. Default **`label.style_label_down`**.

`style` is the **anchor/gravity selector as well as the shape selector** `[UM]`: *"The argument used
has an impact on the visual appearance of the label **and on its position relative to the reference
point** determined by either the `y` value or the top/bottom of the bar when `yloc.abovebar` or
`yloc.belowbar` are used."* `label_up` = balloon above the anchor with its tail pointing down at it,
`label_down` = below-anchor tail pointing up, `label_left`/`label_right` = beside the anchor,
`label_*_left`/`label_*_right` = corner-anchored, `label_center` = centred on the anchor.
`label.style_none` renders text only with no marker; `label.style_text_outline` draws outlined text
with no balloon. **Exact pixel offsets and tail geometry per style are UNVERIFIED for all 21.**

#### 4.3.3 Setters — 15, all `void`, all series-capable

| Signature | Semantics |
|---|---|
| `label.set_x(id, x)` | *"Sets bar index or bar time (**depending on the `xloc`**)"*; carries the 500-bar-future note |
| `label.set_y(id, y)` | price; visible only under `yloc.price` |
| `label.set_xy(id, x, y)` | both |
| `label.set_point(id, point)` | `chart.point` form |
| `label.set_xloc(id, x, xloc)` | changes the interpretation **and** supplies a new `x` in the new units |
| `label.set_yloc(id, yloc)` | *"Sets new y-location calculation algorithm."* |
| `label.set_text(id, text)` | |
| `label.set_text_formatting(id, text_formatting)` | `series text_format` |
| `label.set_text_font_family(id, text_font_family)` | 2 values |
| `label.set_color(id, color)` | *"New label border and arrow color."* |
| `label.set_textcolor(id, textcolor)` | |
| `label.set_style(id, style)` | any of 21 |
| `label.set_size(id, size)` | reference: *"Sets **arrow and text size**"* ⇒ `size` scales the marker/balloon too, not only the glyphs |
| `label.set_textalign(id, textalign)` | 3 values |
| `label.set_tooltip(id, tooltip)` | |

#### 4.3.4 Getters — exactly three

| Signature | Returns |
|---|---|
| `label.get_x(id) → series int` | *"UNIX time or bar index (**depending on the last `xloc` value set**)"* |
| `label.get_y(id) → series float` | *"price of this label's position"* |
| `label.get_text(id) → series string` | text |

⚠ **There is no `label.get_style`, `get_color`, `get_size`, `get_tooltip`, `get_textalign`, `get_xloc`
or `get_yloc`.** A script cannot round-trip a label's full state through the Pine API; it must shadow
what it needs. A renderer that exposes extra getters is not Pine.

Lifecycle: `label.delete(id)` — *"If it has already been deleted, does nothing."* `label.copy(id)` —
clones into a **new independent id consuming a new quota slot**. `label.all → array<label>`,
read-only, index 0 = oldest.

#### 4.3.5 `yloc` — `y` is genuinely ignored above/below bar

Reference (`yloc`): *"If `yloc = yloc.price`, **y** argument specifies the price of the label position.
If `yloc = yloc.abovebar`, label is located **above bar**. If `yloc = yloc.belowbar`, label is located
**below bar**. Default is `yloc.price`."*
Reference (`y`): *"Price of the label position. **It is taken into account only if `yloc =
yloc.price`.**"*
`[UM]`, unambiguous: *"**If `yloc` is `yloc.abovebar` or `yloc.belowbar` then the `y` argument is
ignored.**"*

⇒ Under `abovebar`/`belowbar` the anchor is derived from the bar at `x` — that bar's high or low — and
`y` is inert. `label.new(bar_index, 0, …, yloc = yloc.abovebar)` is a valid, documented idiom, as is
`label.new(bar_index, high, …, yloc = yloc.abovebar)`. `label.set_y()` on such a label stores a value
with no visual effect until `yloc` is set back to `yloc.price`. The **pixel gap** between the bar
extreme and the label, and whether it scales with `size`, are UNVERIFIED.

#### 4.3.6 Text layout

- **Multi-line via `\n` only.** `textalign` aligns the lines against each other within the text block.
  There is **no vertical align and no wrap for labels** — no `text_wrap` parameter exists, and
  `text.align_top`/`text.align_bottom` are not accepted. The only line breaks are the ones in the
  string. v6 also allows triple-quoted `"""…"""` literals, which embed the newlines without `\n`.
- **Maximum text length / line count: UNVERIFIED.**
- `text_font_family` accepts exactly two constants; concrete typefaces, metrics and fallback are
  UNVERIFIED.
- `size.auto` (0) means the renderer chooses; **the auto-sizing rule is UNVERIFIED**.

#### 4.3.7 Renderer must reproduce

- **C49.** `label.new()` resolves two overloads — `(chart.point, …)` 13 params and `(x, y, …)` 14 params — in
  the exact orders above.
- **C50.** Every `label.new()` parameter accepts `series` **except** `force_overlay`, which is `const bool`.
- **C51.** `label.new()` copies the `chart.point`'s values; mutating that point afterwards does not move the
  label.
- **C52.** Default `style` is `label.style_label_down`; all 21 style strings are accepted and 20 of them are
  not `label.style_label_down`.
- **C53.** `style` selects the balloon's position relative to the anchor as well as its shape.
- **C54.** `y` is consumed only under `yloc.price`; under `yloc.abovebar`/`yloc.belowbar` the anchor comes
  from the bar at `x` and `y` has no visual effect.
- **C55.** `label(size=)` accepts a positive int **or** a `size.*` constant, mapping 0 / ~7 / ~10 / 12 / 18 /
  24, default 12.
- **C56.** `label.set_size()` scales the marker/balloon **and** the text.
- **C57.** `textalign` accepts only `text.align_left`, `text.align_center`, `text.align_right`; passing
  `text.align_top` is an error.
- **C58.** Label text splits on `\n`; no wrapping and no vertical alignment is applied.
- **C59.** `text_formatting` composes additively: `text.format_bold + text.format_italic` renders bold italic.
- **C60.** `label.color` paints the border/arrow/balloon; `label.textcolor` paints the glyphs — two
  independent channels.
- **C61.** Exactly three getters exist (`get_x`, `get_y`, `get_text`); any other getter is not part of the API.
- **C62.** `label.get_x()` returns a bar index or a UNIX time according to the **last `xloc` set**, not the
  creation-time `xloc`.
- **C63.** `label.delete()` on an already-deleted id is a silent no-op.
- **C64.** `label.copy()` yields a new independent id that consumes a quota slot.
- **C65.** `label.all` is read-only, oldest-first, index 0 = the next eviction victim; `array.push`/`set`/
  `remove` against it must be rejected.

---

### 4.4 Lines and linefills — `line.*`, `linefill.*`

**`line.*`: 21 functions (`line.new` ×2 overloads ⇒ 22 entries) + `line.all`.**
**`linefill.*`: 5 functions + `linefill.all`.** There is **no `linefill.copy`, no linefill geometry
setter, and no `max_linefills_count`.**

#### 4.4.1 `line.new()` — two overloads

```
line.new(x1, y1, x2, y2, xloc, extend, color, style, width, force_overlay) → series line   // 10
line.new(first_point, second_point, xloc, extend, color, style, width, force_overlay) → series line // 8
```

| Param | Qualified type | Req | Default | Notes |
|---|---|---|---|---|
| `x1`, `x2` | `series int` | **yes** | — | bar index or UNIX ms per `xloc`; *"cannot be drawn further than 500 bars into the future"*. `[UM]` adds the floor `bar_index - 10000` |
| `y1`, `y2` | `series int/float` | **yes** | — | always **prices** — lines have no `yloc` |
| `first_point`, `second_point` | `chart.point` | **yes** (ov. 2) | — | |
| `xloc` | `series string` | no | **`xloc.bar_index`** | selects the point's `index` vs `time` field |
| `extend` | `series string` | no | **`extend.none`** | 4 values, §4.4.3 |
| `color` | `series color` | no | reference states **none**; `[UM]`: **`color.blue`** | |
| `style` | `series string` | no | reference states **none**; `[UM]`: **`line.style_solid`** | 6 values |
| `width` | `series int` | no | reference states **none**; `[UM]`: **`1`** px | *"Line width in pixels."* |
| `force_overlay` | **`const bool`** | no | **`false`** | |

⚠ **Provenance note, verified against the payload:** unlike `box.new()`, whose colour/width/style
defaults are stated in the reference itself, `line.new()`'s `color`, `style` and `width` carry **no
default sentence at all**. The values `color.blue` / `line.style_solid` / `1` are `[UM]`-only.

`line.new()` has **no `text`, no `tooltip` and no font parameters** — lines carry no text.

#### 4.4.2 The 6 `line.style_*` values

```
line.style_solid       (default)
line.style_dotted
line.style_dashed
line.style_arrow_left    "Solid line with arrow on the first point."
line.style_arrow_right   "Solid line with arrow on the second point."
line.style_arrow_both    "Solid line with arrows on both points."
```

All `const string`. Dash/dot periods and arrowhead sizes are **UNVERIFIED**. **Consumer subsets
differ:** `line.new(style=)` and `polyline.new(line_style=)` accept all 6; `box.new(border_style=)`
accepts only the first 3 (§4.5.2).

#### 4.4.3 `extend.*` — the anchor asymmetry that will bite

Reference verbatim (`line.new` `extend`, restated as the `desc` of `line.set_extend`):

> "If `extend = extend.none`, draws **segment** starting at point (x1, y1) and ending at point (x2, y2).
> If `extend` is equal to `extend.right` or `extend.left`, draws a **ray** starting at point (x1, y1) or
> (x2, y2), **respectively**. If `extend = extend.both`, draws a **straight line that goes through these
> points**. Default value is `extend.none`."

Read the mapping carefully — it is counter-intuitive and a likely renderer bug source:

| `extend` | Result | Ray anchored at |
|---|---|---|
| `extend.none` *(default)* | segment (x1,y1)→(x2,y2) | — |
| `extend.right` | ray | **(x1, y1)** |
| `extend.left` | ray | **(x2, y2)** |
| `extend.both` | infinite straight line through both points | — |

In both ray cases the *other* endpoint is the direction-defining point and the ray continues past it.
What is extended is the line's **own geometry, slope preserved** — the extension is not horizontal
unless the line is. `line.get_price()` reads the `extend.both` version of the line regardless of the
line's actual `extend`, which confirms the extension is the mathematical continuation of the segment.

Whether an extended ray is clipped at the pane's price bounds, whether it affects autoscale, and
whether it extends into or beyond the 500-bar future region are all **UNVERIFIED**.

#### 4.4.4 Setters and getters

Setters (all `void`, all series-capable): `set_x1`, `set_y1`, `set_xy1`, `set_x2`, `set_y2`, `set_xy2`,
`set_first_point`, `set_second_point`, `set_xloc(id, x1, x2, xloc)`, `set_extend`, `set_color`,
`set_style`, `set_width`.

Getters: `get_x1`, `get_y1`, `get_x2`, `get_y2` (x getters return index-or-time *"depending on the last
`xloc` value set"*), plus:

| `line.get_price(id, x) → series float` |
|---|
| *"Returns the price level of a line at a given bar index."* Two remarks: **"The line is considered to have been created using `extend = extend.both`."** and **"This function can only be called for lines created using `xloc.bar_index`. If you try to call it for a line created with `xloc.bar_time`, it will generate an error."** `[UM]`: works *"including at bar indices outside the line's start and end points"*. ⇒ it evaluates the **infinite** line through both points. |

There is **no `line.get_extend`, `get_color`, `get_style`, `get_width` or `get_xloc`.**

`line.delete()` idempotent; `line.copy()` — *"Any changes to the copied line instance do not affect the
original"* — new id, new quota slot; `line.all` read-only, oldest-first.

⚠ **Documented gap, verified by enumerating the payload:** the 500-bar-future note appears on 17
entries — including `line.set_x1`, `line.set_x2`, `line.set_xy1` — but **not** on `line.set_xy2`, nor
on `line.set_xloc`/`box.set_xloc`/`label.set_xloc`. This is a documentation inconsistency, not a
behavioural difference; treat the bound as global to `xloc.bar_index`.

#### 4.4.5 `linefill`

```
linefill.new(line1, line2, color) → series linefill
```

| Param | Qualified type | Req |
|---|---|---|
| `line1` | `series line` | **yes** |
| `line2` | `series line` | **yes** |
| `color` | `series color` | **yes** — no default |

**All three required.** Members: `linefill.set_color(id, color)`, `linefill.get_line1(id)`,
`linefill.get_line2(id)`, `linefill.delete(id)` (idempotent), `linefill.all` (read-only, oldest-first).

Reference remarks, verbatim:

> "**If any line of the two is deleted, the linefill object is also deleted.** If the lines are moved
> (e.g. via `line.set_xy()` functions), the linefill object is also moved. **If both lines are extended
> in the same direction relative to the lines themselves** (e.g. both have `extend.right` as the value
> of their `extend=` parameter), **the space between line extensions will also be filled**."

`[UM]`: linefills *"automatically determine their fill boundaries using the properties from the `line1`
and `line2` IDs that they reference… Scripts **cannot move linefills directly**."* And:
**"Any pair of `line` instances can only have one `linefill` between them"** — a second
`linefill.new()` on the same pair creates a new id that **replaces** the previous one.

`fill()` does **not** work with `line` objects; `linefill` is the only mechanism.

Whether the geometry is the quadrilateral between the segments' endpoints or a per-x-column vertical
fill between the two lines' y-values (they differ when the segments have different x-ranges) is
**UNVERIFIED**; the linefill of two lines with mismatched x-ranges is undefined by the docs.

#### 4.4.6 Renderer must reproduce

- **C66.** `line.new()` resolves two overloads — 10-param scalar and 8-param chart-point — in the orders
  above.
- **C67.** Line `y` coordinates are always prices; lines have no `yloc`.
- **C68.** `extend.right` anchors the ray at **(x1, y1)**; `extend.left` anchors it at **(x2, y2)**.
- **C69.** `extend.both` draws the infinite line through both points, slope preserved; extensions are never
  forced horizontal.
- **C70.** `line.get_price(id, x)` evaluates the line as if `extend = extend.both`, including for x outside
  the segment.
- **C71.** `line.get_price()` on a line created with `xloc.bar_time` **raises an error**.
- **C72.** A line whose two points are identical draws nothing but **still holds an id** against the quota.
- **C73.** `line.new(style = …)` accepts all 6 `line.style_*` values, arrows included.
- **C74.** `linefill.new()` requires all three arguments; there is no default colour.
- **C75.** Deleting **either** line deletes the linefill; moving either line moves it.
- **C76.** Two lines both extended in the same direction have the space between their **extensions** filled
  too.
- **C77.** A second `linefill.new()` on the same line pair **replaces** the first — a pair holds at most one
  linefill.
- **C78.** Linefills cannot be moved directly and have no geometry setter.
- **C79.** `fill()` rejects `line` ids.
- **C80.** No `line.get_extend`/`get_color`/`get_style`/`get_width`/`get_xloc` exists.

---

### 4.5 Boxes — `box.*`

**Surface: 29 functions (`box.new` ×2 overloads ⇒ 30 entries) + `box.all`** — 22 setters, 4 getters,
`new`, `copy`, `delete`.

#### 4.5.1 `box.new()` — two overloads

```
box.new(top_left, bottom_right, border_color, border_width, border_style, extend, xloc, bgcolor,
        text, text_size, text_color, text_halign, text_valign, text_wrap, text_font_family,
        force_overlay, text_formatting) → series box                                      // 17

box.new(left, top, right, bottom, border_color, border_width, border_style, extend, xloc, bgcolor,
        text, text_size, text_color, text_halign, text_valign, text_wrap, text_font_family,
        force_overlay, text_formatting) → series box                                      // 19
```

⚠ **Positional trap: `text_formatting` is last, appended *after* `force_overlay`, in both overloads.**

Coordinates:

| Param | Qualified type | Req | Notes |
|---|---|---|---|
| `top_left`, `bottom_right` | `chart.point` | **yes** (ov. 1) | `[UM]`: *"The function **copies** the information from these chart points"* ⇒ pass-by-value at construction |
| `left` | `series int` | **yes** (ov. 2) | bar index or UNIX ms per `xloc`; 500-bar-future note |
| `top` | `series int/float` | **yes** (ov. 2) | *"Price of the top border of the box."* |
| `right` | `series int` | **yes** (ov. 2) | 500-bar-future note |
| `bottom` | `series int/float` | **yes** (ov. 2) | price |

⚠ **Correction to an input lane, verified.** One lane reported that the reference's ARGUMENTS block
for `box.new` documents only overload 1's coordinates, and marked `left`/`top`/`right`/`bottom` types
as "strongly inferred" from the parallel setters. **The payload does carry all four**, with full
descriptions and the types above, on a distinct 19-argument overload entry. That lane's browser-DOM
scrape missed them. These four types are now **verified from the reference**, not inferred.

Shared parameters (identical in both overloads):

| Param | Qualified type | Default | Allowed values |
|---|---|---|---|
| `border_color` | `series color` | **`color.blue`** | any colour; `na` legal |
| `border_width` | `series int` | **`1`** ("1 pixel") | pixels |
| `border_style` | `series string` | **`line.style_solid`** | ⚠ **only** `line.style_solid`, `line.style_dotted`, `line.style_dashed` — **3 of 6, no arrows** |
| `extend` | `series string` | **`extend.none`** | 4 values, §4.5.3 |
| `xloc` | `series string` | **`xloc.bar_index`** | 2 values |
| `bgcolor` | `series color` | **`color.blue`** | any colour; `na` legal |
| `text` | `series string` | **`""`** | |
| `text_size` | `series int/string` | **`size.auto` (0)** | any positive int, or the 6 `size.*` constants (box mapping 0/8/10/14/20/36) |
| `text_color` | `series color` | **`color.black`** | |
| `text_halign` | `series string` | **`text.align_center`** | left / center / right |
| `text_valign` | `series string` | **`text.align_center`** | top / center / bottom |
| `text_wrap` | `series string` | **`text.wrap_none`** | `text.wrap_none`, `text.wrap_auto` |
| `text_font_family` | `series string` | **`font.family_default`** | 2 values |
| `force_overlay` | **`const bool`** | **`false`** | const only |
| `text_formatting` | `series text_format` | **`text.format_none`** | additive |

Note the default asymmetry against polylines: **`box.bgcolor` defaults to `color.blue` (filled)**,
while **`polyline.fill_color` defaults to `na` (unfilled)**.

#### 4.5.2 Border channels

`border_color`, `border_width` and `border_style` are each **global to all four sides** — reference:
*"Color of the four borders"*, *"Width of the four borders, in pixels"*, *"Style of the four borders"*.
**Per-side styling does not exist in Pine.** `bgcolor` is an independent channel: *"Background color of
the box"* / `[UM]` *"the space inside the box"*. Transparency rides on the colour value
(`color.new(c, 70)`), never a separate parameter.

`box.set_border_style(id, style)` documents *"New border style"* with **no** possible-values list —
treat it as the 3-value box subset.

#### 4.5.3 `extend` on boxes — horizontal borders only

Reference verbatim:

> "When `extend.none` is used, the horizontal borders start at the left border and end at the right
> border. With `extend.left` or `extend.right`, the horizontal borders are extended indefinitely to the
> left or right of the box, respectively. With `extend.both`, the horizontal borders are extended on
> both sides. Optional. The default value is `extend.none`."

⇒ Extension applies to the **top and bottom borders only**; the vertical left/right borders stay at
their coordinates. **Whether `bgcolor` extends with them is UNVERIFIED** — the reference describes only
the borders.

Note this is a *different* semantic from `line`'s `extend`, which uses the same four constants to mean
ray-anchoring. Same namespace, two behaviours.

#### 4.5.4 Text placement and wrapping

`text_halign` positions horizontally within the box bounds; `text_valign` vertically. Both default to
`text.align_center`. There is **one text run per box** — no rich-text spans; `text_formatting` applies
to the whole string.

Reference `text_wrap`, verbatim:

> "Whether to wrap text. Wrapped text starts a new line when it reaches the side of the box. Wrapped
> text lower than the bottom of the box is not displayed. Unwrapped text stays on a single line and *is
> displayed* past the width of the box if it is too long. **If the `text_size` is 0 or `text.wrap_auto`,
> this setting has no effect.** The default value is `text.wrap_none`."

Extracted rules:

1. `text.wrap_auto` → break at the box's **left/right** edges; **clip** anything below the bottom edge.
2. `text.wrap_none` → single line, allowed to **overflow horizontally** with no clip.
3. **`text_size == 0` (i.e. `size.auto`) disables wrapping entirely** — and since `size.auto` is the
   *default* `text_size` for boxes, the **default box can never wrap**.

The sentence's second clause ("or `text.wrap_auto`") is self-referential and reads as a documentation
defect (§9); the `text_size == 0` half is coherent and is treated as authoritative.

#### 4.5.5 The 22 setters and 4 getters

Setters — all `void`, mutate in place, arg 1 is `id (series box)`, all series-capable:
`set_top_left_point`, `set_bottom_right_point`, `set_left`, `set_right`, `set_top`, `set_bottom`,
`set_lefttop`, `set_rightbottom`, `set_xloc`, `set_extend`, `set_border_color`, `set_border_width`,
`set_border_style`, `set_bgcolor`, `set_text`, `set_text_color`, `set_text_size`, `set_text_halign`,
`set_text_valign`, `set_text_wrap`, `set_text_font_family`, `set_text_formatting`.

⚠ **`box.set_xloc` parameter order is `(id, left, right, xloc)` — `xloc` is LAST.** `[UM]`'s prose
describes it xloc-first and is misleading; trust the signature. `line.set_xloc(id, x1, x2, xloc)` has
the same shape. There is **no way to change `xloc` without restating both x values** — which is
correct, since their units change.

Getters — only four: `box.get_left(id) → series int`, `box.get_right(id) → series int`,
`box.get_top(id) → series float`, `box.get_bottom(id) → series float`. The x getters return a bar index
or a UNIX ms timestamp *"depending on the last value used for `xloc`"* — which confirms `xloc` is
stored per-box state. **There are no getters for colour, width, style, extend, text, any text
property, or `xloc` itself.**

`box.copy()` clones (*"Any changes to the copied box do not affect the original"*) into a new id and a
new quota slot; `box.delete()` is idempotent; `box.all` is read-only and oldest-first.

#### 4.5.6 Renderer must reproduce

- **C81.** `box.new()` resolves two overloads — 17-param chart-point and 19-param scalar-edge — with
  `text_formatting` last in both.
- **C82.** `box.new()` **copies** its `chart.point` arguments; mutating the point afterwards does not move the
  box.
- **C83.** `border_color`, `border_width` and `border_style` apply to all four sides; per-side values are not
  expressible.
- **C84.** `box.new(border_style = line.style_arrow_left)` is invalid — boxes accept only solid/dotted/dashed.
- **C85.** `border_color` and `bgcolor` both default to `color.blue`; `text_color` defaults to `color.black`;
  `text_size` defaults to `size.auto` (0).
- **C86.** `extend.left`/`right`/`both` extend the **horizontal** borders only; the vertical borders stay put.
- **C87.** `text.wrap_auto` wraps at the side borders and clips text below the bottom border.
- **C88.** `text.wrap_none` overflows horizontally without clipping.
- **C89.** `text_size == 0` (`size.auto`) disables wrapping regardless of `text_wrap` — so the default box
  never wraps.
- **C90.** `box.set_xloc(id, left, right, xloc)` binds `xloc` **last**.
- **C91.** Exactly four getters exist, and `box.get_left`/`get_right` return units per the **last** `xloc` set.
- **C92.** A box whose corners are identical draws nothing but still consumes an id.
- **C93.** `box.new(na, na, na, na, …)` creates a live invisible box that consumes an id.

---
### 4.6 Polylines and chart points — `polyline.*`, `chart.point.*`

#### 4.6.1 `polyline.new()` — one signature, no overloads

```
polyline.new(points, curved, closed, xloc, line_color, fill_color, line_style, line_width,
             force_overlay) → series polyline
```

Reference: *"Creates a new polyline instance and displays it on the chart, sequentially connecting all
of the points in the `points` array with line segments. The segments in the drawing can be straight or
curved depending on the `curved` parameter."*

| # | Param | Qualified type | Req | Default | Notes |
|---|---|---|---|---|---|
| 1 | `points` | **`array<chart.point>`** | **yes** | — | connected **in array order from index 0** |
| 2 | `curved` | `series bool` | no | **`false`** | §4.6.4 |
| 3 | `closed` | `series bool` | no | **`false`** | also connects last → first |
| 4 | `xloc` | `series string` | no | **`xloc.bar_index`** | selects each point's `index` vs `time` field |
| 5 | `line_color` | `series color` | no | **`color.blue`** | colour of **all** segments — no per-segment colour |
| 6 | `fill_color` | `series color` | no | **`na`** | ⚠ unfilled by default, unlike `box.bgcolor` |
| 7 | `line_style` | `series string` | no | **`line.style_solid`** | **all 6** `line.style_*`, arrows included |
| 8 | `line_width` | `series int` | no | **`1`** | pixels |
| 9 | `force_overlay` | **`const bool`** | no | **`false`** | |

#### 4.6.2 The entire polyline surface is three members

`[UM]` verbatim: *"Unlike lines or boxes, polylines **do not have functions for modification or reading
their properties**. To redraw a polyline on the chart, one can *delete* the existing instance and
*create* a new polyline with the desired changes."*

⇒ `polyline.new()`, `polyline.delete()` (*"It has no effect if the `id` doesn't exist"*), and the
read-only `polyline.all` (index 0 = oldest). **No `set_*`, no `get_*`, no `copy`.** Delete-and-recreate
is the only update path — which makes the 100-id budget and the eviction rule far more load-bearing
for polylines than for boxes.

#### 4.6.3 The 10,000-point cap

**Maximum 10,000 points**, ⇒ **9,999 segments open / 10,000 segments closed**. Three `[UM]`/`[RN]`
confirmations:

1. `[UM]`: *"These powerful drawings can connect up to **10,000 points** at any available location on
   the chart…"*
2. `[UM]`: *"…such a drawing would be limited to a maximum of 500 line segments. **This single unclosed
   polyline drawing, on the other hand, can contain up to 9,999 line segments.**"*
3. `[RN]`: *"…an array of **up to 10,000 chart points**…"*

⚠ **The 10,000 figure is NOT in the reference payload.** `polyline.new` has no `remarks` block at all,
and a full-payload search for "10,000"/"10000" returns only `initial_capital` matches. Single-sourced.

**One polyline = one id regardless of point count.** 10,000 points cost one polyline slot. That is the
whole reason polylines exist: `[UM]` contrasts *"a maximum of 500 line segments"* (500 line ids) against
*"up to 9,999 line segments"* in **one** id. The collections limit (100,000 elements) is not the binding
constraint; 10,000 is. Behaviour when a >10,000-point array is passed, and when the array is empty or
has one element, is **UNVERIFIED**.

#### 4.6.4 `curved` — what is documented, and what is not

**No curve family is named in any source.** What is documented:

- `[UM]`: *"the resulting polyline interpolates **nonlinear** values between the coordinates from each
  `chart.point` in its array of `points` to generate a curvy effect."*
- `[UM]`: *"The data used to construct a polyline heavily impacts the smooth, **piecewise function** it
  interpolates between its points. **In some cases, the interpolated curve can reach beyond its actual
  coordinates.**"*
- `[UM]`: *"both polylines pass through all coordinates from the `points` array"* ⇒ it is
  **interpolating**, not approximating.
- `[UM]`'s worked example proves overshoot: horizontal lines at each point's price, and the curved
  polyline *"occasionally reaches beyond the vertical boundaries indicated by the horizontal lines,
  whereas the polyline drawn using straight segments does not."*

⇒ Established: **piecewise · interpolating (passes exactly through every point) · may overshoot the
control-point envelope · smooth at the knots.** That signature fits a non-monotone cubic family
(natural cubic / Catmull-Rom / Bézier with derived tangents), but **TradingView does not name which, and
this document does not assert one.** A renderer must either treat exact curve geometry as
out-of-contract or reverse-engineer it empirically (§8).

#### 4.6.5 `closed`, `fill_color`, and x-monotonicity

- `closed = false` (default): open path, *n* points → *n−1* segments.
- `closed = true`: additionally connects last → first, *n* points → *n* segments.
- **The docs never state that `fill_color` requires `closed = true`.** `[UM]`'s phrase *"the closed
  space filled by the polyline drawing"* implies implicit closure for fill purposes on an open path, but
  is not explicit — **UNVERIFIED**. The fill rule for self-intersecting paths (nonzero vs even-odd
  winding) is likewise **undocumented**.
- **Non-monotonic and duplicate x are legal.** No source requires monotonic `index`/`time`, and `[UM]`'s
  own "N-sided polygons" example builds vertices from an ellipse —
  `int xValue = int(math.round(xScale * math.cos(angle))) + bar_index` — so x rises then falls, and
  `math.round` produces duplicate consecutive x at low `xScale`. It renders as a closed polygon.
  ⇒ **Treat `points` as an ordered path in 2-D, NOT as a function of x. Never sort, dedupe, or assume
  monotonicity.** Whether the *curved* interpolant is well-behaved on non-monotonic x is separately
  **UNVERIFIED** — a spline parameterised by x would degenerate there; one parameterised by arc length
  or point index would not, and TradingView does not say which.

#### 4.6.6 `chart.point` — the coordinate carrier

Type `chart.point`, a **reference type**, three fields:

| Field | Type | Meaning |
|---|---|---|
| `index` | `series int` | x-coordinate as a **bar index** |
| `time` | `series int` | x-coordinate as **UNIX time, milliseconds** |
| `price` | `series float` | y-coordinate |

**Two x-coordinates coexist in one point.** `[UM]`: *"The `time` and `index` fields both denote
x-coordinates. Drawings use either `time` or `index` based on their `xloc` property; by default,
drawings use `index` and ignore `time`."* Fields are **mutable**.

Constructors — five, **none with overloads**:

| Signature | `index` | `time` | Notes |
|---|---|---|---|
| `chart.point.new(time, index, price)` | set | set | ⚠ **argument order is `time` first, then `index`** — the reverse of the field-listing order. Reference: *"this function **does not verify** that the `time` and `index` values refer to the same bar."* |
| `chart.point.from_index(index, price)` | set | **`na`** | *"drawing objects with `xloc` values set to `xloc.bar_time` **will not work** with them"* |
| `chart.point.from_time(time, price)` | **`na`** | set | *"…`xloc.bar_index` **will not work** with them"* |
| `chart.point.now(price)` | set | set | `price` **optional, default `close`** — the only defaulted argument in the family. Records both fields on the executing bar, *"making it suitable for use with drawing objects of any `xloc` type"* |
| `chart.point.copy(id)` | inherits | inherits | *"identical `time`, `index`, and `price` values"* |

Compatibility matrix a renderer should validate against:

| Constructor | `xloc.bar_index` | `xloc.bar_time` |
|---|---|---|
| `chart.point.new` | ✅ | ✅ (but the two x fields may disagree — unvalidated) |
| `chart.point.from_index` | ✅ | ❌ documented "will not work" |
| `chart.point.from_time` | ❌ documented "will not work" | ✅ |
| `chart.point.now` | ✅ | ✅ |
| `chart.point.copy` | inherits | inherits |

⚠ The **failure mode** of the ❌ cells is stated only as *"will not work"* — compile error vs runtime
error vs silently-skipped point vs `na`-coordinate no-draw is **UNVERIFIED**. Given that `na`
coordinates are legal and yield a live-but-invisible id, silent no-draw is the most likely behaviour,
but this document does not assert it.

**Copy semantics split.** `box.new()` and `label.new()`/`line.new()` are documented to **copy** their
chart-point arguments. **`polyline.new()` is not documented either way** — whether mutating the array or
its points after the call alters the drawing is **UNVERIFIED** and is a real renderer decision point.

#### 4.6.7 Version gate

`polyline` and `chart.point` were introduced in **Pine v5** — `chart.point` September 2023, polylines
October 2023 `[RN]`. **Neither exists in v1–v4.** A renderer targeting all versions must gate the whole
point-array API on `@version >= 5`.

#### 4.6.8 Renderer must reproduce

- **C94.** `polyline.new()` has exactly nine parameters in the order given and no overloads.
- **C95.** `polyline.new()` connects `points` in array order from index 0; `closed = true` adds the
  last→first segment.
- **C96.** `fill_color` defaults to `na` (unfilled), in contrast to `box.bgcolor`'s `color.blue`.
- **C97.** `line_style` accepts all 6 `line.style_*` values (arrows included), unlike `box.border_style`.
- **C98.** One polyline consumes one id regardless of point count; 10,000 points is the documented ceiling
  (9,999 segments open, 10,000 closed).
- **C99.** A curved polyline passes **exactly through every input point** and may **overshoot** the min/max of
  its control points.
- **C100.** Polyline points are an ordered 2-D path: non-monotonic x and duplicate consecutive x are accepted
   and must not be sorted or deduplicated.
- **C101.** The polyline surface is exactly `new`, `delete`, `all` — no setter, getter or copy exists; updates
   are delete-and-recreate.
- **C102.** `polyline.delete()` on a non-existent id is a silent no-op.
- **C103.** `chart.point.new()` binds **`time` first, then `index`**, and does not validate that they name the
   same bar.
- **C104.** `chart.point.from_index()` leaves `time` as `na`; `chart.point.from_time()` leaves `index` as `na`.
- **C105.** `chart.point.now()` populates both x fields and defaults `price` to `close`.
- **C106.** A drawing reads **only** the point field its `xloc` selects.
- **C107.** `polyline`/`chart.point` are rejected on the `@version <= 4` path.

---

### 4.7 Tables — `table.*`

**Surface: 22 functions + `table.all`.** 21 of the 22 also exist in method form — every function
**except** `table.new()`. Reference remark on the type: *"**Table objects are always of 'series'
form.**"*

#### 4.7.1 Two-phase construction

`[UM]`: *"A table's structure and key attributes are defined using `table.new()`, which returns a table
ID… The `table.new()` call will create the table object but **does not display it**. Once created, and
for it to display, the table must be populated using one `table.cell()` call for each cell."* Reference
remark on `table.new()` says the same: *"the table will not be displayed until its cells are
populated."*

`columns` and `rows` are **immutable after construction** — `[UM]`: *"All table attributes **except its
number of columns and rows** can be modified using setter functions."* There is no `table.set_columns()`
or `table.set_rows()`.

**No getters exist at all** — `[UM]`: *"Unlike for lines, boxes, and labels, scripts cannot use getter
functions to retrieve properties for tables drawn on the chart. To refer to an attribute of a table
later in a script, first store the value in a separate variable."*

#### 4.7.2 `table.new()` — 9 parameters

```
table.new(position, columns, rows, bgcolor, frame_color, frame_width, border_color,
          border_width, force_overlay) → series table
```

| # | Param | Qualified type | Req | Default | Notes |
|---|---|---|---|---|---|
| 1 | `position` | `series string` | **yes** | — | the 9 `position.*` constants |
| 2 | `columns` | `series int` | **yes** | — | no documented maximum |
| 3 | `rows` | `series int` | **yes** | — | no documented maximum |
| 4 | `bgcolor` | `series color` | no | **"no color"** | |
| 5 | `frame_color` | `series color` | no | **"no color"** | the **outer** frame |
| 6 | `frame_width` | `series int` | no | **`0`** | |
| 7 | `border_color` | `series color` | no | **"no color"** | cell borders, *"**excluding the outer frame**"* |
| 8 | `border_width` | `series int` | no | **`0`** | |
| 9 | `force_overlay` | **`const bool`** | no | **`false`** | the only `const` parameter; there is **no `table.set_force_overlay()`** |

#### 4.7.3 `table.cell()` — 14 parameters, and it is a PUT not a PATCH

```
table.cell(table_id, column, row, text, width, height, text_color, text_halign, text_valign,
           text_size, bgcolor, tooltip, text_font_family, text_formatting) → void
```

| # | Param | Qualified type | Req | Default |
|---|---|---|---|---|
| 1 | `table_id` | `series table` | **yes** | — |
| 2 | `column` | `series int` | **yes** | — (**0-based**) |
| 3 | `row` | `series int` | **yes** | — (**0-based**) |
| 4 | `text` | `series string` | no | **`""`** |
| 5 | `width` | `series int/float` | no | auto-fit; *"**Value 0 has the same effect**"* |
| 6 | `height` | `series int/float` | no | auto-fit; `0` ≡ auto |
| 7 | `text_color` | `series color` | no | **`color.black`** |
| 8 | `text_halign` | `series string` | no | **`text.align_center`** (left/center/right) |
| 9 | `text_valign` | `series string` | no | **`text.align_center`** (top/center/bottom) |
| 10 | `text_size` | `series int/string` | no | **`size.normal` (= 14)** |
| 11 | `bgcolor` | `series color` | no | **"no color"** |
| 12 | `tooltip` | `series string` | no | UNVERIFIED (none stated) |
| 13 | `text_font_family` | `series string` | no | **`font.family_default`** |
| 14 | `text_formatting` | `series text_format` | no | **`text.format_none`** |

Reference remarks — all three are load-bearing:

> 1. "This function does not create the table itself, but defines the table's cells. To use it, you
>    first need to create a table object with `table.new()`."
> 2. "**Each `table.cell()` call overwrites all previously defined properties of a cell.** If you call
>    `table.cell()` twice in a row, e.g., the first time with `text='Test Text'`, and the second time
>    with `text_color=color.red` but without a new `text` argument, the default value of the 'text'
>    being an empty string, it will overwrite 'Test Text', and your cell will display an empty string.
>    If you want, instead, to modify any of the cell's properties, use the `table.cell_set_*()`
>    functions."
> 3. "**A single script can only display one table in each of the possible locations.** If
>    `table.cell()` is used on several bars to change the same attribute of a cell … only the last
>    change will be reflected… Avoid unnecessary setting of cell properties by enclosing function calls
>    in an `if barstate.islast` block whenever possible."

⇒ **`table.cell()` is a full replace with defaults for every unspecified field; `table.cell_set_*()` are
field patches. Implement them as two distinct operations. Never implement `cell()` as a merge.**

#### 4.7.4 Setters

**11 cell setters**, all shaped `(table_id, column, row, <value>) → void`:

```
table.cell_set_text(table_id, column, row, text)
table.cell_set_tooltip(table_id, column, row, tooltip)
table.cell_set_width(table_id, column, row, width)
table.cell_set_height(table_id, column, row, height)
table.cell_set_text_color(table_id, column, row, text_color)
table.cell_set_bgcolor(table_id, column, row, bgcolor)
table.cell_set_text_halign(table_id, column, row, text_halign)
table.cell_set_text_valign(table_id, column, row, text_valign)
table.cell_set_text_size(table_id, column, row, text_size)
table.cell_set_text_font_family(table_id, column, row, text_font_family)   // value REQUIRED
table.cell_set_text_formatting(table_id, column, row, text_formatting)     // value REQUIRED
```

Only the last two mark their value argument **required**; the other nine are optional.
`cell_set_width`/`_height`: *"Passing 0 auto-adjusts the width/height based on the text inside of the
cell."*

**6 table setters:**

```
table.set_position(table_id, position)        // position REQUIRED, 9 values
table.set_bgcolor(table_id, bgcolor)          // optional, default no color
table.set_frame_color(table_id, frame_color)  // optional, default no color
table.set_frame_width(table_id, frame_width)  // optional, default 0
table.set_border_color(table_id, border_color) // optional, default no color — "excluding the outer frame"
table.set_border_width(table_id, border_width) // optional, default 0
```

⚠ Wording drift a renderer must reconcile: `table.cell()` documents `width`/`height` as *"a % of the
**indicator's visual space**"*, while `table.cell_set_width()`/`_set_height()` say *"a % of the **chart
window**"*. Same mechanism, two phrasings; treat as **% of the script's own pane**, corroborated by
`[UM]`'s example using `width = 100, height = 100` from `position.middle_center` to cover the pane.

#### 4.7.5 `table.clear()`, `table.delete()`, `table.merge_cells()`

```
table.delete(table_id) → void
table.clear(table_id, start_column, start_row, end_column, end_row) → void
table.merge_cells(table_id, start_column, start_row, end_column, end_row) → void
```

`table.clear()` — removes a rectangle of cells, `start_*` = top-left, `end_*` = bottom-right.
**`end_column` and `end_row` are optional**, defaulting to *"the argument used for `start_column`"* /
`start_row` ⇒ `table.clear(t, 2, 3)` clears exactly cell (2,3).

`table.merge_cells()` — **all five parameters required.** Reference remarks, all four verbatim:

> 1. "This function will **merge cells, even if their properties are not yet defined with
>    `table.cell()`**."
> 2. "The resulting merged cell **inherits all of its values from the cell located at
>    `start_column`:`start_row`, except width and height**. The width and height of the resulting merged
>    cell are based on the width/height of other cells in the neighboring columns/rows and **cannot be
>    set manually**."
> 3. "To modify the merged cell with any of the `table.cell_set_*` functions, **target the cell at the
>    `start_column`:`start_row` coordinates**."
> 4. "**An attempt to merge a cell that has already been merged will result in an error.**"

`[RN]` March 2022 adds the geometric constraint: *"you can merge cells in any direction, **as long as
the resulting cell doesn't affect any already merged cells and doesn't go outside of the table's
bounds**."*

#### 4.7.6 The 9 `position.*` constants and the 9-table cap

```
position.top_left      position.top_center      position.top_right
position.middle_left   position.middle_center   position.middle_right
position.bottom_left   position.bottom_center   position.bottom_right
```

All `const string`. **There are no other `position.*` members in v6** (verified against the full
239-constant set).

**Cap: 9 displayed tables, one per anchor.** `[UM]` verbatim: *"Scripts can display a maximum of nine
tables on the chart, one for each of the possible locations… When attempting to place two tables in the
same location, **only the newest instance will show on the chart**."* `[UM]` *Visuals / Overview*:
*"the table that is drawn latest in the code replaces any previous tables."* **No error** — the loser is
silently not rendered, and still exists as an object in `table.all`.

⇒ Renderer rule: a `Map<position, tableId>` slot map per script, resolved in draw order, last write
wins per bar.

**Maximum columns / rows / total cells: NO NUMBER IS DOCUMENTED ANYWHERE.** `[UM]`'s only statement is
circular — *"Limits on the quantity of cells in all tables are determined by the total number of cells
used in one script"* — plus *"The maximum number of cells that can be displayed … will depend on your
viewing device's resolution and the portion of the display used by your chart."* `table.new()`'s
reference entry states no bound on `columns`/`rows`. **Do not borrow 500/100/64/100,000 — those are
documented for other object classes.** Pick a defensive ceiling and log when it is hit (§8).

#### 4.7.7 Layout model: pane-anchored, viewport-relative, pan/zoom-immune

`[UM]`, four independent statements:

- *"tables are **not anchored to specific bars**; they float in a script's space … **independently of the
  chart bars being viewed or the zoom factor used**."*
- *"this heatmap's cells are not linked to chart bars… **the heatmap will not change as the chart is
  panned horizontally, or scaled**."*
- *"Tables are anchored to the pane space itself, **not to any x or y chart coordinates**. As such, they
  **remain fixed in size and position when zooming into or scrolling across the chart**."*
- *"Most drawing types have x and y coordinates, so drawing objects move as the user scrolls the chart
  or zooms in or out. **The only exception is tables**."*

Two sizing regimes coexist: **auto** (intrinsic — the widest/tallest text in the column/row) and
**explicit** (`width`/`height` as a **percentage of the pane's visual space**, so a cell rescales when
the pane is resized but never when the chart is zoomed or panned). Positioning expands **away from the
anchor**: *"a table anchored to the `position.middle_right` reference will be drawn by expanding up,
down and left from that anchor."*

⇒ A table is an overlay layer in **pane coordinates**, laid out over `(0..100%, 0..100%)` of the pane
box, completely decoupled from the bar↔x and price↔y transforms.

#### 4.7.8 Re-render discipline

Tables are **not** a per-bar series output — only their final state survives. `[UM]`:

> "Displayed table contents always represent **the last state of the table**, as it was drawn on the
> script's last execution, on the dataset's last bar. Contrary to values displayed in the Data Window or
> in indicator values, variable contents displayed in tables will thus **not change as a script user
> moves his cursor over specific chart bars**. For this reason, **it is strongly recommended to always
> restrict execution of all `table.*()` calls to either the first or last bars of the dataset.**"

Canonical pattern — `var` for the object, `if barstate.islast` for the content, series maths **outside**
the guard:

```pinescript
//@version=6
indicator("ATR", "", true)
var table atrDisplay = table.new(position.top_right, 1, 1)
myAtr = ta.atr(14)              // must execute every bar
if barstate.islast
    table.cell(atrDisplay, 0, 0, str.tostring(myAtr))
```

`[UM]` names the trap explicitly: `str.tostring(ta.atr(14))` *inside* the `if` block *"would not have
evaluated correctly because it would be called on the dataset's last bar without having calculated the
necessary values from the previous bars."* Also: `var` inside an `if barstate.islast` block initialises
on the **first last-bar execution**, not at `bar_index == 0`.

Strategy caveat `[UM]`: *"unless the strategy uses `calc_on_every_tick = true`, table code enclosed in
`if barstate.islast` blocks will not execute on each realtime update, so the table will not display as
you expect."*

Numeric values must be stringified by the script (`str.tostring()`); `text` is a string parameter, so a
renderer never receives a raw number for a cell.

#### 4.7.9 Renderer must reproduce

- **C108.** `table.new()` creates but does **not** display; a table renders only once at least one cell is
   defined.
- **C109.** `columns` and `rows` are fixed at construction; no setter can resize a table.
- **C110.** No table getter of any kind exists.
- **C111.** `table.cell()` **replaces** the whole cell record, filling every unspecified field with its
   default — calling it twice with disjoint arguments loses the first call's values.
- **C112.** `table.cell_set_*()` patches exactly one field and leaves the rest intact.
- **C113.** `column`/`row` indices are 0-based.
- **C114.** `width`/`height` of `0` means auto-fit, identical to omitting them.
- **C115.** `table.cell(text_size=)` maps `size.*` to 0/8/10/14/20/36 and defaults to `size.normal` (14) —
   the **box/table** mapping, not the label mapping.
- **C116.** `text_halign` accepts left/center/right; `text_valign` accepts top/center/bottom.
- **C117.** `table.clear(t, c, r)` with `end_*` omitted clears exactly the single cell (c, r).
- **C118.** `table.merge_cells()` requires all five arguments and merges an inclusive axis-aligned rectangle.
- **C119.** A merged region inherits everything from `(start_column, start_row)` **except** width/height,
   which are derived from neighbouring columns/rows and cannot be set.
- **C120.** `cell_set_*` writes addressed to a merged region must target the anchor cell.
- **C121.** Merging a region that overlaps an existing merge **raises an error**; merging outside the table's
   bounds is disallowed; merging cells that were never defined is legal.
- **C122.** At most one table renders per `position.*`; a later table at an occupied position silently
   replaces the earlier one, which still exists in `table.all`.
- **C123.** Tables are laid out in pane coordinates and do not move or rescale under chart pan or zoom.
- **C124.** Explicit `width`/`height` are percentages of the pane's visual space, so `width = 100,
   height = 100` fills the pane.
- **C125.** A table's rendered content is its state as of the script's last execution; it does not vary with
   cursor position.
- **C126.** `table.new()` accepts `force_overlay` and there is no `table.set_force_overlay()`.
- **C127.** Tables generate **zero** plot counts and have no `max_tables_count`.
- **C128.** Tables sit in the topmost z-bucket and cannot be reordered below any other Pine visual.

---

### 4.8 Declaration — `indicator()`

#### 4.8.1 The 17 parameters

```
indicator(title, shorttitle, overlay, format, precision, scale, max_bars_back, timeframe,
          timeframe_gaps, explicit_plot_zorder, max_lines_count, max_labels_count,
          max_boxes_count, calc_bars_count, max_polylines_count, dynamic_requests,
          behind_chart) → void
```

Reference remark: *"**Every indicator script must include exactly one `indicator()` statement in the
code.**"*

| # | Param | Type | Req | Default | Range / values |
|---|---|---|---|---|---|
| 1 | `title` | `const string` | **yes** | — | any string |
| 2 | `shorttitle` | `const string` | no | **`""`** | replaces `title` in most chart locations when non-empty |
| 3 | `overlay` | `const bool` | no | **`false`** | |
| 4 | `format` | `const string` | no | **`format.inherit`** | `format.inherit`, `format.price`, `format.volume`, `format.percent` |
| 5 | `precision` | `const int` | no | inherits the chart's | **0 to 16** |
| 6 | `scale` | `const scale_type` | no | unset ⇒ main price scale of its pane | `scale.right`, `scale.left`, `scale.none` |
| 7 | `max_bars_back` | `const int` | no | auto-computed per series | **0 to 5000** |
| 8 | `timeframe` | `const string` | no | `""` ⇒ chart's timeframe | any valid timeframe string |
| 9 | `timeframe_gaps` | `const bool` | no | **`true`** | requires `timeframe` |
| 10 | `explicit_plot_zorder` | `const bool` | no | **`false`** | §2.2 |
| 11 | `max_lines_count` | `const int` | no | **~50** | ceiling 500 (`[UM]`/`strategy()`) |
| 12 | `max_labels_count` | `const int` | no | **~50** | ceiling 500 |
| 13 | `max_boxes_count` | `const int` | no | **~50** | ceiling 500 |
| 14 | `calc_bars_count` | `const int` | no | **`0`** (= all history) | non-negative int |
| 15 | `max_polylines_count` | `const int` | no | **~50** | ceiling 100 |
| 16 | `dynamic_requests` | `const bool` | no | **`true`** | v6 default; a v5→v6 behaviour change |
| 17 | `behind_chart` | `const bool` | no | **`true`** | effective only when `overlay = true` |

**Every parameter is `const`-qualified** ⇒ the entire declaration resolves at compile time; nothing in
`indicator()` is series-dependent.

**Not parameters of `indicator()` in v6 — do not invent them:** `resolution`, `resolution_gaps` (v4
names, renamed to `timeframe`/`timeframe_gaps`), `linktoseries`, `max_lines`, `overlay_force`, and
`force_overlay` (a per-call argument, never a declaration argument). `strategy()` shares most of these
but **not** `timeframe`/`timeframe_gaps`.

#### 4.8.2 Coupling rules a compiler/renderer must enforce

| Rule | Source |
|---|---|
| `timeframe_gaps` is allowed **only if** the call includes `timeframe` | reference |
| `timeframe` is allowed **only if** the script uses **no drawing types and no `alert()` calls** — and `table` is a drawing type, so a table-drawing script **cannot** use `timeframe` | reference |
| `scale.none` is valid **only if** `overlay = true` | reference |
| `behind_chart` takes effect **only when** `overlay = true` | reference |
| Setting `precision` while `format` is `format.inherit` **silently promotes** the format to `format.price` | reference |
| `format.volume` **overrides** `precision` in both `indicator()` and `plot*()` | reference |
| A per-plot `format`/`precision` **overrides** the declaration's | reference |
| `overlay`, `scale` and `behind_chart` changes **apply only after the user re-adds the script**; a user "Move to" pane choice permanently overrides `overlay` | reference |

`scale` decision matrix:

| `overlay` | `scale` | Own pane? | Own y-transform? | New scale axis drawn? |
|---|---|---|---|---|
| `false` *(default)* | unset | yes (separate pane) | yes (pane's own) | pane's own scale, default side |
| `false` | `scale.right` / `scale.left` | yes | yes | **no new scale** — only positions the pane's scale |
| `false` | `scale.none` | — | — | **invalid** (requires `overlay = true`) |
| `true` | unset | no (host pane) | **no** — shares the host's price scale | none |
| `true` | `scale.right` / `scale.left` | no | **yes** — independent auto-fit | **yes**, an extra scale on that side |
| `true` | `scale.none` | no | **yes** — independent auto-fit | none; numbers ride the existing scale |

Also: a plot with `display = display.none` *"does not affect the scale of the script's visual space"* —
hidden plots are excluded from auto-fit.

#### 4.8.3 `force_overlay` — exactly 12 functions, verified

⚠ **Resolved conflict.** One input lane's heading claimed **14** distinct functions accept
`force_overlay`, while its own enumeration listed 12. Enumerating the payload gives **12**:

**Plot family (7):** `plot()`, `plotshape()`, `plotchar()`, `plotarrow()`, `plotbar()`, `plotcandle()`,
`bgcolor()`.
**Drawing family (5):** `box.new()`, `line.new()`, `label.new()`, `polyline.new()`, `table.new()`.

**Do NOT accept it:** `fill()` (all three overloads), `hline()`, `barcolor()`, `linefill.new()` — and
**no method form of any function carries it** (0 of the 251 method entries). In every case the type is
**`const bool`**, default `false`.

Reference wording, two variants: drawings — *"If `true`, **the drawing will display on the main chart
pane, even when the script occupies a separate pane**"*; plots — *"the plotted results will display on
the main chart pane…"*.

`force_overlay` arrived in the **v5** era in two waves `[RN]`: **April 2024** (the 7 plot-family
functions) and **June 2024** (the 5 drawing constructors). So the correct version gate is
`@version >= 5`, not v6.

#### 4.8.4 Renderer must reproduce

- **C129.** `indicator()` accepts exactly the 17 named parameters above, all `const`, and exactly one
   `indicator()` statement per script.
- **C130.** `overlay` defaults to `false` (separate pane) and `behind_chart` defaults to `true` (script stack
   behind the candles) — and `behind_chart` is inert when `overlay = false`.
- **C131.** `explicit_plot_zorder` defaults to `false` and, when `true`, reorders only plots, hlines and fills.
- **C132.** `scale.none` with `overlay = false` is rejected.
- **C133.** `timeframe_gaps` without `timeframe` is rejected.
- **C134.** `timeframe` in a script that creates any drawing object (**including a table**) or calls `alert()`
   is rejected.
- **C135.** `precision` outside 0–16 is rejected; `max_bars_back` outside 0–5000 is rejected.
- **C136.** Passing `precision` while `format` is `format.inherit` yields effective `format.price`.
- **C137.** `format.volume` makes `precision` inert wherever both are set.
- **C138.** Exactly 12 functions accept `force_overlay`; passing it to `fill()`, `hline()`, `barcolor()`,
   `linefill.new()`, or to any method form, is rejected.
- **C139.** `force_overlay` is `const bool` — a series or input argument is rejected.
- **C140.** `force_overlay = true` promotes one visual to the main chart pane; no mechanism does the inverse.

---
## 5. Cross-cutting semantics

### 5.1 The rollback / realtime-bar model — the single most important drawing contract

This is fully documented, and it is where naive renderers break.

`[UM]` *Language / Execution model*, verbatim:

> "Before each new script execution on an open bar, the runtime system executes a **rollback** process,
> which **reverts** all applicable variables, expressions, and objects to their **last committed states**
> as of the previous bar's close."

> "If a script creates objects on an open bar and does not assign their references to variables declared
> with the **`varip`** keyword, **the rollback process removes those objects**."

> "During the next execution on the open bar, the script creates **new objects** if the updated logic
> allows it."

> "For example, if a script calls `label.new()` to create a label object on the open bar, **the system
> deletes that object during rollback**. On the next execution, the script evaluates `label.new()` again,
> creating a new label that replaces the output. The label created on the previous tick no longer
> exists."

> "Similarly, for objects of built-in or user-defined types with references assigned to **`var`**
> variables, **the rollback process reverts any changes to those objects** that occur on the open bar.
> The only exception is for UDTs with fields that include the `varip` keyword."

Commit: *"After the script executes on an elapsed realtime bar's closing tick, the system commits
necessary data from that execution to the time series… It does not commit the data from executions on
the bar's unconfirmed values from previous ticks."*

**`var` is NOT sufficient**, verbatim: *"Although these variables preserve data across successive bars,
they **do not** preserve data across executions on the *ticks* of an open bar. Rollback reverts all
variables declared with `var` before the current bar to the last committed states in the time series as
of the previous bar."*

**`varip` is the escape**, verbatim: *"Variables or fields declared with the `varip` keyword **do not**
revert to a previously committed state. They persist across **all** script executions after
initialization, even those on the ticks of an open realtime bar."*

The classification that makes this apply: *"User-defined types (UDTs) and special types, such as
collections and **drawing types**, are **reference types**."*

#### The renderer contract

1. Maintain a **committed snapshot** at the last bar close.
2. On **every intra-bar tick**: restore that snapshot — destroying objects created since **and undoing
   setter mutations to surviving objects** — then re-run the script.
3. On the **closing tick**, commit; the drawings become permanent until deleted or evicted.
4. **Object ids are not stable across ticks on an open bar.** A renderer must not cache by id across
   ticks of an unconfirmed bar.
5. `varip`-held references escape rollback entirely. Mixing `varip` (survives) with `var` (rolls back)
   is where scripts leak or double-draw.
6. The state store must be **snapshot/restore capable per bar**, not append-only. This applies to
   tables identically: a non-`var` `table.new()` on the open bar is deleted and recreated each tick,
   while a `var table` survives but has all its intra-bar cell mutations reverted and re-applied.

Documented exceptions to rollback (**none of them drawings**): `varip` variables/fields, Pine Logs
messages, strategy order data, alert logs, and runtime errors (which halt execution). Strategies do not
roll back by default — *"they execute only once per bar at each closing tick without undergoing
rollback"* — unless `calc_on_every_tick = true` or `calc_on_order_fills = true`.

#### Gate choice changes the cost model, not just the visuals

| Gate | Objects created | Surviving objects | Intra-bar churn |
|---|---|---|---|
| none | **O(bars)** — one per historical bar | last `max_*_count` after FIFO eviction | current bar churns every tick |
| `if barstate.islast` | once per historical dataset, then **every realtime tick** (`islast` is *"true for all real-time bars"*) | **O(1)** | **O(ticks)** create/destroy — make delete cheap, not just create |
| `if barstate.islastconfirmedhistory` | **once**, never on realtime ticks | O(1) | **zero** — why `[UM]`'s polyline examples use it (polylines cannot be modified) |
| `if barstate.isconfirmed` | one per qualifying bar | O(bars) | **zero** intra-bar |

`barstate.islast`, `barstate.isconfirmed`, `barstate.isrealtime` and
`barstate.islastconfirmedhistory` all carry the reference remark *"Pine Script code that uses this
variable could calculate differently on history and real-time data"*, and three of them additionally
*"using this variable/function can cause indicator repainting."*

### 5.2 `na` handling, per primitive

| Primitive | `na` behaviour |
|---|---|
| `plot()` `style_line`/`stepline`/`area` | **bridges** — joins the most recent non-`na` to the next non-`na` |
| `plot()` `style_linebr`/`areabr` | **breaks** — no join across the gap |
| `plot()` `style_columns`/`histogram` | **UNVERIFIED** — no source says whether `na` yields no column or a zero-height one |
| `plot(color = na)` | plots the value, paints nothing (also the documented conditional-plot idiom, alongside 100-transparency) |
| `plotshape`/`plotchar`, non-absolute location | `na` **or 0** ⇒ mark suppressed |
| `plotshape`/`plotchar`, `location.absolute` | `na` ⇒ nothing drawn; otherwise the value is y |
| `plotarrow` | `na` **or 0** ⇒ no arrow |
| `plotcandle`/`plotbar` | **any one** of O/H/L/C `na` ⇒ **entire bar dropped**, atomically, no partial render |
| `fill()` | either bounding plot `na` ⇒ fill **breaks** (default) or **holds** (`fillgaps = true`); never interpolates |
| `bgcolor`/`barcolor` | `na` *"leaves bars as is"* — the documented single-bar-colouring idiom |
| `hline(price = na)` | the documented way to hide an hline (with `color(na)` and `display.none`) |
| drawing objects, any `na` coordinate | object is **created and invisible**, and **still consumes an id** |
| `color.from_gradient` | `na` is a legal endpoint colour; out-of-range values clamp rather than yielding `na` |
| v6 `bool` | ⚠ **`bool` can no longer be `na`** — strictly `true`/`false`. Undefined `if`/`switch` branches return `false`, and history-referencing a bool on bar 0 returns `false`. In v1–v5 both returned `na`. |
| v6 unique types | parameters expecting unique types (e.g. `plot.style_*`) **no longer accept `na`**; a conditional feeding one must guarantee non-`na`, so `switch` needs `default` and `if` needs `else` |

### 5.3 `xloc` and `yloc` coordinate semantics

| | `xloc.bar_index` *(default)* | `xloc.bar_time` |
|---|---|---|
| Meaning of `x` | an **absolute bar index** | a **UNIX time in milliseconds**, matching a bar's `open` time |
| `chart.point` field read | `index` | `time` |
| Forward bound | **`bar_index + 500`**, hard: *"cannot be drawn further than 500 bars into the future"* (17 reference entries) + `[UM]` *"A maximum of 500 bars in the future can be referenced."* | no documented forward cap |
| Backward bound | **`bar_index - 10000`** `[UM]` only: *"the minimum x-coordinate allowed is `bar_index - 10000`. For larger offsets, one can use `xloc.bar_time`."* | no documented cap — the documented escape hatch |
| Accuracy | exact — indices are integral chart columns | `[UM]`: *"because of varying time gaps and missing bars when markets are closed, the **positioning of the label may not always be exact**. Time offsets of the sort tend to be more reliable on 24x7 markets."* |
| `line.get_price()` | supported | **error** |
| Point constructor compatibility | needs `index` ⇒ `from_time()` points will not work | needs `time` ⇒ `from_index()` points will not work; `now()` works for both |

**⇒ x-domain for `xloc.bar_index` is `[bar_index - 10000, bar_index + 500]`.**

Drawing beyond the last bar is **explicitly allowed**: lines, boxes and polylines *"can have coordinates
at any available location on the chart, **including ones at future times beyond the last chart bar**"*,
and `label.new(bar_index + 10, high)` is a documented idiom. The chart's right-hand area extends to
accommodate them.

**What happens when a bound is exceeded is UNVERIFIED** — the docs say only "cannot be drawn" /
"maximum … can be referenced", and their mitigation is to cap user input with `maxval = 500`. Clamp vs
drop vs runtime error is unknown, as is the snapping rule for a `bar_time` x landing in a market-closed
gap or outside the dataset.

`yloc` — **labels only.** `yloc.price` *(default)* consumes `y`; `yloc.abovebar` and `yloc.belowbar`
**ignore `y` entirely** and derive the anchor from the bar at `x` (§4.3.5). **Lines, linefills, boxes and
polylines have no `yloc`: their y coordinates are always prices.** Tables have neither `xloc` nor `yloc`
— they live in pane coordinates (§4.7.7).

### 5.4 Chart-edge clipping, autoscale, collision — documented nowhere

An exhaustive search of the reference payload and the `visuals/{text-and-shapes,lines-and-boxes,fills}`
and `writing/limitations` pages finds **zero** statements about:

- label (or any drawing) **clipping** at a pane edge;
- **shifting/nudging** a drawing into view;
- any **collision or overlap resolution** between drawing objects;
- whether drawings participate in **autoscale** — the word "autoscale" does not appear in the reference
  payload at all.

The only clipping statement in the entire corpus is box-internal text wrapping (`text_wrap`
"clips the wrapped text when it extends past the borders"), and labels have no `text_wrap` parameter.
The closest adjacent facts: overlap avoidance is the **script author's** job in every official example
(*"to prevent overlaps"*, *"prevent the polygon drawings from overlapping"*), z-order is script-level not
per-object, and pane/scale placement is `scale.*`.

⇒ **Clipping, edge behaviour, overlap handling and autoscale participation are implementation-defined.**
A renderer must choose, document the choice, and expect diffs against the real product there. This is
the largest single block of undefined presentation behaviour in Pine.

### 5.5 Series-vs-const argument qualification

The lattice is **`const → input → simple → series`**, ascending. A parameter accepts its documented
qualifier **and everything weaker**. Renderer/compiler consequences:

| Pattern | Members | Consequence |
|---|---|---|
| **`const` only** | `force_overlay` (all 12 functions), `plot(force_overlay)`, `fillgaps`, `plotshape/plotchar` `text` and `size`, `plot(title)` and every `title`, all 17 `indicator()` parameters | Resolvable at compile time. `force_overlay` is a compile-time **pane-routing** decision, which is why no setter for it exists on any object. |
| **`input`/`simple` ceiling** | `plot(linewidth, style, trackprice, histbase, join, editable, show_last, display, format, precision, linestyle)`, `plot(offset)` = `simple int`, all `hline()` parameters | Cannot vary per bar. ⚠ `offset` was `series int` in v5 and is `simple int` in v6 — a real breaking change. |
| **`series` everywhere** | every `label.*`/`line.*`/`box.*`/`polyline.*`/`table.*` parameter **except `force_overlay`**; `fill(color, top_value, bottom_value, top_color, bottom_color)`; `bgcolor(color)`; `barcolor(color)`; every plot-family colour | Per-bar mutation is the norm for drawing objects and the exception for plots. |

Two traps worth stating separately:

- **`hline()` is the most restricted primitive in the language**: `price` is `input int/float` and
  `color` is `input color` and *"must be a constant value (not an expression)"*. The documented
  substitute for a dynamic level is `plot(<constant>)` made invisible with `color = na` or
  `display = display.none`.
- **v6 re-qualified variables that v5 mislabelled `const` as `series`**, so they can no longer be
  passed where `simple` is required (e.g. `ta.ema(length)`). The qualifier lattice must be
  **version-aware**, not merged.

### 5.6 Version-dependent RENDERING — the version tag must survive to the paint call

The renderer is version-dependent, not just the parser. Identical source text must paint differently
according to its `//@version=` tag. `//@version=` takes **1 to 6**, and **when the annotation is absent,
version 1 is assumed** — six legal dialects, not two.

| Change | v≤5 | v6 | Class |
|---|---|---|---|
| `color.red` | `#FF5252` | **`#F23645`** | RENDERER |
| `color.teal` | `#00897B` | **`#089981`** | RENDERER |
| `color.yellow` | `#FFEB3B` | **`#FDD835`** | RENDERER |
| `label.new()` default text colour | `color.black` | **`color.white`** | RENDERER |
| `bgcolor()`/`fill()` implicit transparency | **90** in v4 | none from v5 on — transparency must be carried in the colour via `color.new()`/`color.rgb()` | RENDERER (straight alpha-compositing difference for identical code) |
| `transp=` parameter | live in v4, deprecated+hidden in v5 | **removed** from `bgcolor`, `fill`, `plot`, `plotarrow`, `plotchar`, `plotshape` | PARSER |
| `linewidth = 0` | legal | **compilation error** (minimum 1) | PARSER + RENDERER |
| `plot(offset = <series>)` | legal (v5) | **rejected** — `simple int` | PARSER + RENDERER |
| Text size | `size.*` enum buckets only | **also any positive int**, "sizes in typographic points" | PARSER + RENDERER |
| `text_formatting` / `text.format_*` | absent | **new** on `label.new`, `box.new`, `table.cell` | PARSER + RENDERER |
| `plot(linestyle=)` | absent | **new** | PARSER + RENDERER |
| `na` into a unique-type parameter (e.g. `plot.style_*`) | accepted | **rejected** | PARSER + RENDERER |
| `polyline`, `chart.point`, gradient `fill()`, `linefill` | v5+ only (`polyline`/`chart.point` Oct/Sep 2023; gradient `fill` Oct 2022) | present | ALL |
| `force_overlay` | v5+ (Apr/Jun 2024) | present | ALL |
| `behind_chart` | v5+ (Oct 2024) | present | ALL |
| Drawing objects at all (`label`, `line`, `box`, `table`) | **v4+** — v1–v3 have none | present | ALL |

Non-rendering forks that still change what appears on the chart, because they change the numbers:
v6 collapsed `bool` to two-valued logic; `const int` division became fractional (`5 / 2` = `2.5`);
`and`/`or` became lazy (which can starve a `ta.*` call of the every-bar execution its internal state
requires); `for` bounds are re-evaluated per iteration; `timeframe.period` gained its multiplier
(`"D"` → `"1D"`); array indices may be negative. v3 flipped the `security()` lookahead default; v5
changed default session days from Mon–Fri to Sun–Sat. **None of these throw. All of them change
numbers on the chart.**

⇒ **Do not normalise all six dialects into one IR and render it once.** Keep the version tag alive to
the paint call: a version-keyed palette table, a version-keyed default table (label text colour), a
version-keyed compositing rule (v4 implicit transparency 90), and a version-keyed qualifier lattice.

Practical grouping, for staging the work:

| Group | Versions | Renderer burden |
|---|---|---|
| A | v1–v3 | **lowest** — plot family + `hline`/`fill`/`bgcolor`/`barcolor` only; **no drawing objects at all** |
| B | v4 | + label, line, box, table + `max_*_count` budgets; **implicit transparency 90** on `bgcolor`/`fill` |
| C | v5 | + linefill, polyline (≤10k points), `chart.point`, gradient `fill`, `force_overlay` pane routing, `behind_chart` |
| D | v6 (a moving target) | + new colour hexes, white default label text, `linewidth ≥ 1`, int text sizes, `text_formatting`, `plot(linestyle=)`, `box.set_xloc()` |

---

## 6. Complete constant appendix

**239 constants across 35 namespaces** (47 namespace/underscore families), enumerated from the reference
payload. The **Type** column is the payload's own `type` field — note that several families are **not**
`const string`, and that distinction is type-checked (§4.0).

### 6.1 Presentation-critical namespaces

| Namespace / family | # | Type | Members |
|---|---:|---|---|
| `plot.style_*` | **11** | `const plot_style` | `plot.style_line` · `plot.style_linebr` · `plot.style_stepline` · `plot.style_stepline_diamond` · `plot.style_histogram` · `plot.style_cross` · `plot.style_area` · `plot.style_areabr` · `plot.style_columns` · `plot.style_circles` · `plot.style_steplinebr` |
| `plot.linestyle_*` | **3** | `const plot_line_style` | `plot.linestyle_solid` · `plot.linestyle_dashed` · `plot.linestyle_dotted` |
| `shape.*` | **12** | `const string` | `shape.xcross` · `shape.cross` · `shape.circle` · `shape.triangleup` · `shape.triangledown` · `shape.flag` · `shape.arrowup` · `shape.arrowdown` · `shape.labelup` · `shape.labeldown` · `shape.square` · `shape.diamond` |
| `location.*` | **5** | `const string` | `location.abovebar` · `location.belowbar` · `location.top` · `location.bottom` · `location.absolute` |
| `label.style_*` | **21** | `const string` | `label.style_none` · `label.style_xcross` · `label.style_cross` · `label.style_triangleup` · `label.style_triangledown` · `label.style_flag` · `label.style_circle` · `label.style_arrowup` · `label.style_arrowdown` · `label.style_label_up` · `label.style_label_down` · `label.style_label_left` · `label.style_label_right` · `label.style_label_lower_left` · `label.style_label_lower_right` · `label.style_label_upper_left` · `label.style_label_upper_right` · `label.style_label_center` · `label.style_square` · `label.style_diamond` · `label.style_text_outline` |
| `line.style_*` | **6** | `const string` | `line.style_solid` · `line.style_dotted` · `line.style_dashed` · `line.style_arrow_left` · `line.style_arrow_right` · `line.style_arrow_both` |
| `hline.style_*` | **3** | **`const hline_style`** | `hline.style_solid` · `hline.style_dotted` · `hline.style_dashed` |
| `extend.*` | **4** | `const string` | `extend.none` · `extend.left` · `extend.right` · `extend.both` |
| `xloc.bar_*` | **2** | `const string` | `xloc.bar_index` · `xloc.bar_time` |
| `yloc.*` | **3** | `const string` | `yloc.price` · `yloc.abovebar` · `yloc.belowbar` |
| `size.*` | **6** | `const string` | `size.auto` · `size.tiny` · `size.small` · `size.normal` · `size.large` · `size.huge` |
| `position.*` | **9** | `const string` | `position.top_left` · `position.top_center` · `position.top_right` · `position.middle_left` · `position.middle_center` · `position.middle_right` · `position.bottom_left` · `position.bottom_center` · `position.bottom_right` |
| `text.align_*` | **5** | `const string` | `text.align_left` · `text.align_center` · `text.align_right` · `text.align_top` · `text.align_bottom` |
| `text.format_*` | **3** | **`const text_format`** | `text.format_none` · `text.format_bold` · `text.format_italic` |
| `text.wrap_*` | **2** | `const string` | `text.wrap_none` · `text.wrap_auto` |
| `font.family_*` | **2** | `const string` | `font.family_default` · `font.family_monospace` |
| `display.*` | **7** | `const plot_simple_display` (`none`, `all`) · **`const plot_display`** (other 5) | `display.none` · `display.all` · `display.pane` · `display.status_line` · `display.price_scale` · `display.data_window` · `display.pine_screener` |
| `format.*` | **5** | `const string` | `format.inherit` · `format.price` · `format.volume` · `format.percent` · `format.mintick` |
| `scale.*` | **3** | **`const scale_type`** | `scale.right` · `scale.left` · `scale.none` |
| `color.*` | **17** | `const color` | `color.black` · `color.silver` · `color.gray` · `color.white` · `color.maroon` · `color.red` · `color.purple` · `color.fuchsia` · `color.green` · `color.lime` · `color.olive` · `color.yellow` · `color.navy` · `color.blue` · `color.teal` · `color.aqua` · `color.orange` — hexes in §4.2.5 |

**Presentation subtotal: 129 constants.**

Consumer-subset table — the same constant family is not accepted everywhere:

| Family | Accepted by | Subset |
|---|---|---|
| `line.style_*` | `line.new(style)`, `polyline.new(line_style)` | **all 6** |
| `line.style_*` | `box.new(border_style)`, `box.set_border_style` | **3** — solid/dotted/dashed only |
| `hline.style_*` | `hline(linestyle)` **only** | 3, and a distinct type |
| `text.align_*` | `label.new(textalign)`, `label.set_textalign` | **3** — left/center/right |
| `text.align_*` | `box`/`table` `text_halign` | 3 — left/center/right |
| `text.align_*` | `box`/`table` `text_valign` | 3 — top/center/bottom |
| `size.*` | `plotshape(size)`, `plotchar(size)` | 6 constants, **no int accepted** |
| `size.*` | `label.new(size)` | 6 constants **or any positive int**; ints 0/~7/~10/**12**/18/24 |
| `size.*` | `box.new(text_size)`, `table.cell(text_size)` | 6 constants **or any positive int**; ints 0/8/10/**14**/20/36 |
| `size.auto` | `plotchar`, `plotshape`, `label.new`, `box.new` — **not `table.cell()`** in its own blurb | see D-note in §9 |
| `display.*` | `plot*()` | all 7 (`pine_screener` is `plot()`-only) |
| `display.*` | `fill()`, `hline()`, `bgcolor()`, `barcolor()`, `input*()` | **2** — `none`/`all` only |
| `format.*` | `indicator()`/`strategy()` | `inherit`, `price`, `volume`, `percent` |
| `format.*` | `plot*()` | **3** — `price`, `percent`, `volume` (**no `inherit`**) |
| `format.mintick` | `str.tostring()` **only** | never a `format` argument |

### 6.2 The remaining namespaces (non-presentation, listed for completeness)

| Namespace | # | Type | Members |
|---|---:|---|---|
| `currency.*` | **56** | `const string` | `NONE` · `USD` · `EUR` · `AUD` · `GBP` · `NZD` · `CAD` · `CHF` · `HKD` · `JPY` · `NOK` · `SEK` · `SGD` · `TRY` · `ZAR` · `RUB` · `BTC` · `ETH` · `MYR` · `KRW` · `USDT` · `INR` · `PLN` · `PKR` · `EGP` · `AED` · `COP` · `MXN` · `CLP` · `BRL` · `ARS` · `PEN` · `IDR` · `SAR` · `BDT` · `BHD` · `CNY` · `CZK` · `DKK` · `HUF` · `ILS` · `ISK` · `KES` · `KWD` · `LKR` · `MAD` · `NGN` · `PHP` · `QAR` · `RON` · `RSD` · `THB` · `TND` · `TWD` · `VES` · `VND` |
| `dayofweek.*` | 7 | **`const int`** | `sunday` · `monday` · `tuesday` · `wednesday` · `thursday` · `friday` · `saturday` — ⚠ the reference states the role but **not the numeric values**; the integer each day maps to is UNVERIFIED from the payload |
| `strategy.*` | 5 | `const strategy_direction`, `const string` | `strategy.fixed` · `strategy.cash` · `strategy.percent_of_equity` · `strategy.long` · `strategy.short` |
| `strategy.commission.*` | 3 | `const string` | `percent` · `cash_per_contract` · `cash_per_order` |
| `strategy.direction.*` | 3 | `const string` | `all` · `long` · `short` |
| `strategy.oca.*` | 3 | `const string` | `none` · `cancel` · `reduce` |
| `barmerge.*` | 4 | `const barmerge_gaps`, `const barmerge_lookahead` | `lookahead_off` · `lookahead_on` · `gaps_off` · `gaps_on` — the two families are distinct types and cannot be swapped |
| `math.*` | 4 | **`const float`** | `math.pi` · `math.phi` · `math.rphi` · `math.e` |
| `alert.freq_*` | 3 | `const string` | `freq_all` · `freq_once_per_bar` · `freq_once_per_bar_close` |
| `adjustment.*` | 3 | `const string` | `none` · `splits` · `dividends` |
| `backadjustment.*` | 3 | **`const backadjustment`** | `inherit` · `on` · `off` |
| `settlement_as_close.*` | 3 | **`const settlement`** | `inherit` · `on` · `off` |
| `earnings.*` | 3 | `const string` | `actual` · `estimate` · `standardized` |
| `dividends.*` | 2 | `const string` | `net` · `gross` |
| `splits.*` | 2 | `const string` | `denominator` · `numerator` |
| `session.*` | 2 | `const string` | `session.regular` · `session.extended` — ⚠ `session.*` also has **7 runtime variables** (`session.ismarket`, …) in a different collection |
| `order.*` | 2 | **`const sort_order`** | `order.ascending` · `order.descending` |
| *(no namespace)* | 2 | `null` | `true` · `false` — literals, not typed constants. ⚠ **`na` is not in `constants` at all** — it is a *variable*. |

**Total: 239.**

### 6.3 Identifiers that look like constants but are `variables`

A renderer or type-checker keying off the payload must read **both** collections. 161 variables,
including the ones a presentation layer needs:

| Variable namespace | # | Presentation relevance |
|---|---:|---|
| `syminfo` | 40 | `syminfo.mintick` for `format.mintick` rounding |
| `strategy` | 33 | — |
| *(no namespace)* | 27 | `bar_index`, `time`, `open`/`high`/`low`/`close`, `na` |
| `chart` | 11 | `chart.fg_color`, `chart.bg_color` (used in the documented `bgcolor` idiom) |
| `timeframe` | 11 | `timeframe.isintraday` (used in the `plotcandle` HTF idiom) |
| `ta` | 10 | — |
| `barstate` | 7 | `islast`, `isconfirmed`, `isrealtime`, `islastconfirmedhistory` — §5.1 |
| `session` | 7 | — |
| `box` / `label` / `line` / `linefill` / `polyline` / `table` | 1 each | **the six `.all` arrays** — read-only, oldest-first |

---
## 7. CONFORMANCE CHECKLIST

**How to use this section.** Every numbered item in this document is a single falsifiable assertion,
uniquely numbered and intended to map **one-to-one onto one test**. The numbering is continuous across
the whole document: items **C1–C140** are the "Renderer must reproduce" blocks embedded in §4 (they live
next to the parameter tables they constrain, so a failing test lands beside its spec); items
**C141–C214** below cover the cross-cutting behaviour that belongs to no single family.

An item marked **[UM]** rests on User Manual prose rather than the reference payload — still testable,
but if it fails, re-read §9 before assuming the renderer is wrong. No item here depends on an
UNVERIFIED fact; everything in §8 is deliberately excluded from this checklist, because a test suite
must not assert what nobody has established.

### 7.1 Index of C1–C140 (defined in §4)

| Range | Area | Section |
|---|---|---|
| C1–C28 | Plot family — signatures, styles, `na`, `linewidth`, gating, OHLC atomicity, `show_last`, `display`, structural rules | §4.1.12 |
| C29–C48 | Fills, `hline`, `bgcolor`, `barcolor`, colour functions and constants | §4.2.6 |
| C49–C65 | Labels — overloads, `yloc`, sizes, text, getters, lifecycle | §4.3.7 |
| C66–C80 | Lines and linefills — `extend` anchoring, `get_price`, linefill coupling | §4.4.6 |
| C81–C93 | Boxes — overloads, borders, `extend`, wrapping, setter order, getters | §4.5.6 |
| C94–C107 | Polylines and chart points — point arrays, curves, constructors | §4.6.8 |
| C108–C128 | Tables — construction, PUT-vs-PATCH, merges, position slots, layout | §4.7.9 |
| C129–C140 | Declaration — `indicator()` parameters, coupling rules, `force_overlay` | §4.8.4 |

### 7.2 Z-order (C141–C151)

- **C141.** Visuals paint in nine ordered buckets, ascending: backgrounds → fills → plots → horizontal
  levels → linefills → lines → boxes → labels → tables. **[UM]**
- **C142.** Within one bucket, the element created later in the script's logic paints on top. **[UM]**
- **C143.** A `fill()` paints above every `plot()` in the same script when
  `explicit_plot_zorder = false`. **[UM]**
- **C144.** A `label` paints above a `box`, which paints above a `line`, which paints above a
  `linefill`. **[UM]**
- **C145.** No plot, drawing or fill can paint above a `table`, under any combination of
  `explicit_plot_zorder`, `force_overlay` and `behind_chart`. **[UM]**
- **C146.** The last `bgcolor()` call in source order paints above earlier ones; earlier ones show
  through only via transparency.
- **C147.** `explicit_plot_zorder = true` collapses buckets 2, 3 and 4 (fills, plots, horizontal levels)
  into one sequence ordered by source-call order.
- **C148.** `explicit_plot_zorder = true` leaves backgrounds, linefills, lines, boxes, labels and tables
  in their buckets, unreordered.
- **C149.** `behind_chart = true` (the default) places the script's **entire** visual stack behind the
  chart's own candles; `behind_chart = false` places it in front.
- **C150.** `behind_chart` has no effect when `overlay = false`.
- **C151.** `barcolor()` output participates in **no** bucket — it recolours the chart's own bars, and is
  unaffected by `explicit_plot_zorder` and by the script's pane.

### 7.3 Object limits and quota accounting (C152–C168)

- **C152.** Lines, labels, boxes and polylines are four **independent** FIFO pools; consumption in one
  never evicts from another.
- **C153.** Default retention is **~50** per pool.
- **C154.** `max_lines_count`, `max_labels_count`, `max_boxes_count` accept up to **500**;
  `max_polylines_count` up to **100**. **[UM]** / `strategy()`
- **C155.** All four `max_*_count` parameters are `const int`; an `input.*`-driven argument is rejected.
- **C156.** When a pool overflows, the **oldest** object is deleted automatically, silently, with **no
  runtime error**.
- **C157.** Index 0 of `label.all` / `line.all` / `box.all` / `polyline.all` / `linefill.all` /
  `table.all` is the **oldest** object, and is the next eviction victim.
- **C158.** All six `.all` arrays are read-only; `array.push`/`set`/`remove`/`insert` against them is
  rejected.
- **C159.** The retention limit is **approximate**: a renderer must not assert `count <= max_*_count`,
  and must not assert that exactly `max_*_count` objects survive.
- **C160.** An object created with any `na` coordinate is invisible **and still consumes an id**.
- **C161.** A zero-area box, a zero-length line and a degenerate drawing are invisible **and still
  consume an id**. **[UM]**
- **C162.** `label.copy()`, `line.copy()` and `box.copy()` each allocate a **new** id and consume a
  quota slot; mutations to the copy do not affect the original.
- **C163.** `*.delete()` frees the slot and is **idempotent** — deleting an already-deleted or
  non-existent id is a silent no-op for every drawing type.
- **C164.** One polyline consumes exactly one id regardless of its point count.
- **C165.** At most **9** tables render, one per `position.*`; there is no `max_tables_count`, and the
  loser of a position collision still exists in `table.all`. **[UM]**
- **C166.** A script exceeding **64 plot counts** raises a runtime error whose message reports the
  script's actual plot count. **[UM]**
- **C167.** `hline()`, `line.new()`, `label.new()`, `table.new()` and `box.new()` generate **zero** plot
  counts. **[UM]**
- **C168.** One `plotcandle()` call with all three colour arguments series-qualified generates **7**
  plot counts — the documented per-call maximum. **[UM]**

### 7.4 Rollback and the realtime bar (C169–C179)

- **C169.** Before every execution on an open (unconfirmed) bar, state is reverted to the last committed
  snapshot taken at the previous bar's close. **[UM]**
- **C170.** Drawing objects created during a previous execution of the **same** open bar are
  **destroyed** by rollback, then re-created by the new execution. **[UM]**
- **C171.** Object ids are therefore **not stable across ticks** of an open bar; a renderer must not
  cache by id across intra-bar re-executions. **[UM]**
- **C172.** Setter mutations applied to a **surviving** object during an open bar are **reverted** by
  rollback before the next execution. **[UM]**
- **C173.** `var` does **not** protect an object or a variable from intra-bar rollback. **[UM]**
- **C174.** `varip` does — a `varip`-held reference persists across all ticks of an open bar. **[UM]**
- **C175.** On the bar's closing tick, state is **committed**; drawings then persist until deleted or
  evicted. **[UM]**
- **C176.** A drawing persists across bars once committed — it is not a per-bar output like `plot()`.
  **[UM]**
- **C177.** A `var table` survives rollback while its intra-bar cell mutations are reverted and
  re-applied; a non-`var` `table.new()` on an open bar is destroyed and re-created each tick. **[UM]**
- **C178.** `barstate.islast` is true for **every** realtime bar, so a drawing gated on it is destroyed
  and re-created on every tick. **[UM]**
- **C179.** `barstate.islastconfirmedhistory` runs once and never on realtime ticks, so a drawing gated
  on it is created exactly once with zero churn. **[UM]**

### 7.5 Coordinate semantics (C180–C193)

- **C180.** `xloc.bar_index` (the default) interprets x as an absolute bar index; `xloc.bar_time`
  interprets it as **UNIX milliseconds**.
- **C181.** A drawing reads **only** the `chart.point` field its `xloc` selects — `index` or `time` —
  and ignores the other.
- **C182.** Under `xloc.bar_index`, the forward bound is **`bar_index + 500`**.
- **C183.** Under `xloc.bar_index`, the backward bound is **`bar_index - 10000`**. **[UM]**
- **C184.** `xloc.bar_time` has no documented forward or backward bound and is the documented escape
  hatch for offsets beyond the backward floor. **[UM]**
- **C185.** Placing a drawing at a future x beyond the last bar is legal, and the chart's right-hand
  area extends to accommodate it. **[UM]**
- **C186.** `label.new()`, `line.new()` and `box.new()` **copy** their `chart.point` arguments;
  mutating the point afterwards does not move the drawing. **[UM]**
- **C187.** `y` is consumed only under `yloc.price`; `yloc.abovebar` and `yloc.belowbar` ignore it and
  anchor to the bar at `x`.
- **C188.** Lines, linefills, boxes and polylines have no `yloc`; their y coordinates are always prices.
- **C189.** Tables have neither `xloc` nor `yloc`, are laid out in pane coordinates, and do not move or
  rescale under chart pan or zoom. **[UM]**
- **C190.** `line.get_price(id, x)` evaluates the infinite line through both points regardless of the
  line's actual `extend`.
- **C191.** `line.get_price()` on a line created with `xloc.bar_time` raises an error.
- **C192.** `box.get_left()`/`get_right()` and `label.get_x()`/`line.get_x1()`/`get_x2()` return units
  according to the **last `xloc` set** on that object, not the creation-time `xloc`.
- **C193.** `max_bars_back` bounds how far back a **series value** may be read (0–5000 as a parameter;
  buffers cap at 5000, or 10,000 for `open`/`high`/`low`/`close`/`time`) and is **independent** of the
  x-coordinate placement bounds. **[UM]** for the buffer figures

### 7.6 Argument qualification (C194–C201)

- **C194.** A parameter accepts its documented qualifier and every **weaker** one on the
  `const → input → simple → series` lattice, and rejects stronger ones.
- **C195.** `force_overlay` is `const bool` on all 12 accepting functions; a series, simple or input
  argument is rejected, and no setter for it exists on any object.
- **C196.** All 17 `indicator()` parameters are `const`; the whole declaration resolves at compile time.
- **C197.** `plot(offset = …)` accepts `simple int` and rejects `series int`.
- **C198.** `plotshape(text=)`, `plotshape(size=)`, `plotchar(text=)`, `plotchar(size=)` accept
  **`const string` only**.
- **C199.** `hline(price=)` accepts `input int/float` only; `hline(color=)` accepts `input color` only
  and rejects any expression.
- **C200.** Every `label.*`, `line.*`, `box.*`, `polyline.*` and `table.*` parameter accepts `series`
  **except** `force_overlay`.
- **C201.** `fill()`'s `color`, `top_color`, `bottom_color`, `top_value` and `bottom_value` all accept
  `series`; `fillgaps` accepts `const bool` only.

### 7.7 Version-keyed rendering (C202–C214)

Each of these is a differential test: the **same source text** under two `//@version=` tags must paint
differently.

- **C202.** `//@version=` accepts 1 through 6, and an **absent** annotation means **version 1**. **[UM]**
- **C203.** `color.red` renders `#F23645` under v6 and `#FF5252` under v5. **[UM]**/`[RN]`
- **C204.** `color.teal` renders `#089981` under v6 and `#00897B` under v5. **[UM]**/`[RN]`
- **C205.** `color.yellow` renders `#FDD835` under v6 and `#FFEB3B` under v5. **[UM]**/`[RN]`
- **C206.** `color.blue` renders `#2962ff` (compared case-insensitively), **not** `#2196F3`.
- **C207.** `label.new()` with no `textcolor` renders **white** text under v6 and **black** under v5.
  `[RN]`
- **C208.** `bgcolor()`/`fill()` apply an implicit transparency of **90** under v4 and **none** from v5
  on, for identical source. `[RN]`
- **C209.** `transp=` as a parameter of `bgcolor`, `fill`, `plot`, `plotarrow`, `plotchar` or
  `plotshape` is accepted under v4, accepted-but-hidden under v5, and **rejected** under v6. `[RN]`
- **C210.** `linewidth = 0` is accepted and rendered under v≤5 and is a **compilation error** under v6.
  `[RN]`
- **C211.** An int `size`/`text_size` (typographic points) is accepted under v6 and rejected under v5.
  `[RN]`
- **C212.** `text_formatting` on `label.new`/`box.new`/`table.cell`, and `plot(linestyle=)`, exist under
  v6 only. `[RN]`
- **C213.** `polyline`, `chart.point`, `linefill` and the gradient `fill()` overload are rejected under
  v≤4; `label`, `line`, `box` and `table` are rejected under v≤3. `[RN]`
- **C214.** `force_overlay` and `behind_chart` are accepted under v5 and v6 and rejected under v≤4.
  `[RN]`

**Total: 214 conformance items** (C1–C140 in §4, C141–C214 in §7).

---
## 8. UNVERIFIED register

Every open question from all five lanes, deduplicated. **Nothing here was guessed at, and nothing here
appears in the conformance checklist** — a test suite must not assert what nobody has established.
"Live chart" in the last column means: run the construct in the Pine editor on a real chart and observe
the result; there is no documentary path to the answer.

### 8.1 Geometry and appearance — the largest block (U1–U13)

| # | Open question | What it blocks | How to settle |
|---|---|---|---|
| U1 | Pixel geometry, anchor point and "with text" variant of each of the **12 `shape.*` marks** | Any pixel-accurate `plotshape()` rendering | Live chart + screenshot diff. `[UM]`'s 12-shape table cells are **images with no alt text**, so no documentary path exists |
| U2 | Per-style anchor offsets and balloon/tail geometry for all **21 `label.style_*`** values | Label placement relative to its anchor; `style` is the gravity selector, so this is placement, not just decoration | Live chart. Same image-only problem |
| U3 | Pixel size of each `size.*` constant **as applied to `plotshape`/`plotchar`** | Mark scaling. The documented int tables are scoped to labels (0/~7/~10/12/18/24) and boxes/tables (0/8/10/14/20/36); neither is stated to apply to the plot family, which accepts no int at all | Live chart measurement |
| U4 | `size.auto` (0) resolution rule | What size anything renders at by default — and `size.auto` is the **default** for `plotshape`, `plotchar` and `box.text_size` | Live chart across zoom levels and pane sizes |
| U5 | Concrete typefaces, metrics and fallback behind `font.family_default` / `font.family_monospace`; behaviour if an arbitrary font-name string is passed to the `series string` parameter | Text measurement, and therefore auto-sizing of table columns and box wrapping | Live chart; `[UM]` says only "Pine scripts display strings using the system default font" |
| U6 | Dash and dot periods for `line.style_dotted`/`_dashed` (and the `hline`/`box`/`plot.linestyle` equivalents); arrowhead size for `line.style_arrow_*` | Stroke-pattern parity | Live chart measurement |
| U7 | Pixel gap between the bar extreme and the label under `yloc.abovebar`/`yloc.belowbar`, and whether it scales with `size` | Label placement in the most common label idiom | Live chart |
| U8 | Full semantics of `plot.style_stepline_diamond` and `plot.style_steplinebr` — `na` handling, y-scale rule, diamond geometry | 2 of 11 plot styles | Live chart. The reference gives only display names plus one comparative sentence; `[UM]` omits both entirely (§9 D2) |
| U9 | `na` behaviour for `plot.style_columns` and `plot.style_histogram` — no column, or a zero-height column? | Histogram/column rendering on gaps | Live chart with a deliberately `na`-punctured series |
| U10 | `plotarrow()` length **normalisation**: the denominator (whole dataset / visible range / rolling window), the linearity of the map into `[minheight, maxheight]`, and the all-values-equal degenerate case | **The single largest renderer-facing gap in the plot family** — arrow lengths cannot be reproduced at all without it | Live chart, sweeping a synthetic series and measuring |
| U11 | `plotarrow()` **vertical anchor** — where an arrow's base sits (bar high/low, pane border, or the value itself) | Arrow placement. `plotarrow()` has no `location` parameter and no source states the anchor | Live chart |
| U12 | The **curved-polyline spline family** and any tension parameter | Curve geometry for every `curved = true` polyline | Live chart, fitting against known control points. Established: piecewise, interpolating, overshoot-capable, smooth — never named |
| U13 | Whether the curved interpolant is parameterised by **x, arc length, or point index** | Whether the documented non-monotonic ellipse example curves sanely; a spline parameterised by x degenerates there | Live chart with the `[UM]` ellipse example and `curved = true` |

### 8.2 Defaults the reference simply does not state (U14–U20)

The payload has **no structured default field**; every default in this document was read out of prose.
Where prose is silent there is nothing to report — these are real gaps, in both v5 and v6.

| # | Undocumented default | What it blocks | How to settle |
|---|---|---|---|
| U14 | `title` on **all six** plot-family functions; `color` on all six | Status-line/Data-Window labelling and the default paint colour | Live chart, or read the Settings/Style dialog the script generates |
| U15 | `plotshape`/`plotchar` `textcolor` and `text`; **`plotchar`'s default `char` glyph** | The glyph `plotchar()` draws with no `char` argument — undocumented in v5 **and** v6 | Live chart |
| U16 | `plotarrow` `colorup`/`colordown`; `plotcandle` `color`, `wickcolor`, `bordercolor` | Default candle/arrow paint | Live chart |
| U17 | `label.new()` `color` (border/arrow), `textcolor`, `tooltip` | Default label appearance. ⚠ Note the *version* change **is** documented (`textcolor` black→white at v6) while the *value* is not stated in either version's reference | Live chart, both versions |
| U18 | `hline()` `color` and `linestyle` | Default level appearance | Live chart |
| U19 | `fill()` `color`, `title`, `show_last`; the four gradient arguments' individual defaults | What a `fill()` with only two plot ids renders | Live chart |
| U20 | `table.cell()` `tooltip` | Whether an unset tooltip is absent or empty | Live chart hover |

Related **provenance** gap, not a documentation gap: `line.new()`'s `color`, `style` and `width` have
**no default sentence in the reference at all**. The values `color.blue` / `line.style_solid` / `1` are
`[UM]`-only, unlike `box.new()`'s equivalents, which the reference does state. Treat them as documented
but single-sourced.

### 8.3 Failure modes — every one is "cannot be drawn" with no mechanism (U21–U27)

| # | Open question | What it blocks | How to settle |
|---|---|---|---|
| U21 | Behaviour when x exceeds **`bar_index + 500`** or precedes **`bar_index - 10000`**: clamp, drop the drawing, or runtime error? | Every bounds-check path in the renderer. The docs' own mitigation is to cap user input with `maxval = 500`, which sidesteps the question | Live chart, three probes |
| U22 | Snapping rule for an `xloc.bar_time` x landing in a market-closed gap or outside the dataset (nearest bar? next bar? none?) | `bar_time` placement accuracy. `[UM]` says only that positioning "may not always be exact" | Live chart on a non-24x7 symbol |
| U23 | Exact failure mode of an `xloc`/constructor mismatch (a `from_index` point under `xloc.bar_time`) — compile error, runtime error, skipped point, or `na`-coordinate no-draw? | Point validation. Documented only as "will not work". Silent no-draw is the most likely given §3.3, but is **not asserted here** | Live chart |
| U24 | Behaviour when `polyline.new(points)` exceeds **10,000** points — truncate, error, or no-draw? | Polyline input validation | Live chart with 10,001 points |
| U25 | Behaviour when `points` is **empty or has one element** | Same | Live chart |
| U26 | `plotchar(char = …)` with **more than one codepoint** — a grapheme cluster, a ZWJ/skin-tone emoji, or plain `"AB"`: error, truncate, or render whole? | `char` validation. Established: 1 codepoint works incl. non-BMP (U+1F807), and `""` works. No documented error code covers the rest — `documented-errors.json` holds only `CE10101`, `CE10117`, `CW10003`, `RE10139`, `RE10143`, none plot-related | Live chart, three probes |
| U27 | Maximum permitted `|offset|` on `plot*()`, and whether the status line / Data Window report the value **at the pointer's bar** or **at the pointer's bar shifted by `offset`** | Readout correctness under `offset`. The 500-forward / 10,000-back figures are stated for **drawing x-coordinates**, never for `plot(offset=)` — do not assume they transfer | Live chart with a large offset and a hover probe |

### 8.4 Fills, colours and backgrounds (U28–U32)

| # | Open question | What it blocks | How to settle |
|---|---|---|---|
| U28 | What `fill()` does when the two bounding plots **cross** | Fill geometry through a crossover — the most common fill use case. **No doc sentence states it.** Every official example is a crossing case coloured conditionally on the swap, which is only coherent if the fill survives the cross as an hourglass, but that is inference | Live chart |
| U29 | Whether `fill()`'s **gradient overload** clamps outside `[top_value, bottom_value]` | Gradient edges. `color.from_gradient()` is documented to clamp; the `fill()` gradient overload is not, and the two are separate implementations | Live chart with values outside the band |
| U30 | Mixing a `force_overlay = true` plot with a normal plot in one `fill()` | Whether such a call is legal and, if so, which pane the fill lands in. No statement, no example | Live chart |
| U31 | Two `barcolor()` calls targeting the same bar — which wins? | `barcolor` composition. `barcolor()` is absent from the z-index list, so the bucket rule does not answer it | Live chart |
| U32 | Precedence of `barcolor()` against a script's own `plotcandle()`/`plotbar()` overlay | Whether a recoloured chart bar shows through or under synthetic candles | Live chart |

### 8.5 Drawing objects (U33–U40)

| # | Open question | What it blocks | How to settle |
|---|---|---|---|
| U33 | **Chart-edge behaviour for labels and all drawings** — clip, shift into view, or overflow? **No documented statement exists anywhere** | Edge rendering for every drawing type | Live chart, drawing at the pane edge |
| U34 | **Collision / overlap handling between drawing objects.** No documented statement exists; official examples make spacing the script author's job | Whether the renderer must do anything at all here. Most likely: nothing — but that must be confirmed, not assumed | Live chart with deliberately overlapping labels |
| U35 | Whether drawing objects participate in **pane autoscale** (does a label or a line at an extreme price expand the price range?) | Y-range computation. The word "autoscale" appears **nowhere** in the reference payload | Live chart with an out-of-range drawing |
| U36 | Whether an `extend`ed ray is clipped at the pane's price bounds, whether it affects autoscale, and whether it extends into or beyond the 500-bar future region | Ray rendering | Live chart |
| U37 | Whether `box.bgcolor` **extends** with `extend.left`/`right`/`both`, or only the horizontal borders do | Extended-box fill. The reference describes extension of "the horizontal borders" only; the fill is not mentioned | Live chart |
| U38 | Whether an **inverted box** (`top < bottom`) is normalised, rejected, or drawn | Box coordinate handling | Live chart |
| U39 | **Linefill geometry when the two lines' x-ranges differ** — the quadrilateral between the segments' endpoints, or a per-x-column vertical fill between the two lines' y-values? | Linefill rendering for mismatched lines, which is undefined by the docs | Live chart with two lines of different spans |
| U40 | What `label.get_y()` returns for a label created with `yloc.abovebar` and `y = na` | Getter semantics | Live chart |

### 8.6 Quota accounting and limits (U41–U47)

| # | Open question | What it blocks | How to settle |
|---|---|---|---|
| U41 | Whether an object created with **`na` coordinates appears in `.all`** | Queue idioms built on `.all`. Note the documented asymmetry: an `na`-coordinate object **does** count toward the quota, while `.all` is described as containing "current"/"visible" objects | Live chart, printing `array.size(label.all)` |
| U42 | Whether **linefills are count-limited**, and at what number | Linefill budgeting. There is no `max_linefills_count` parameter and no documented cap; they are implicitly bounded by line count | Live chart, creating linefills until something breaks |
| U43 | Whether **tables count toward any drawing-object budget** | Table budgeting. `table.new()` generates no plot count and there is no `max_tables_count`; whether tables consume the memory-limit (RE10139) budget is unstated | Live chart, many large tables |
| U44 | Whether an **aggregate/total** drawing-object budget exists across the four pools | Whether the four-independent-pools model is correct. No source states a combined ceiling, and no number for one exists | Live chart, filling all four pools simultaneously |
| U45 | **Maximum table columns / rows / total cells** | Table validation. The only official statements are circular ("determined by the total number of cells used in one script") or device-dependent ("will depend on your viewing device's resolution"). **Do not borrow 500/100/64/100,000 — those are documented for other object classes** | Live chart, growing a table until it fails. Until then, pick a defensive ceiling and **log** when it is hit |
| U46 | The **true integer semantics of the "~50 approximate"** retention rule | Exact eviction timing. `[UM]` observes 54 labels displayed under the ~50 default; the rule producing 54 is unspecified | Live chart, counting survivors at several `max_*_count` values |
| U47 | Whether a **per-bar object-creation cap** exists (as distinct from the per-type held-id limit) | Whether a loop creating thousands of objects per bar fails or merely churns the GC. **The absence of any documented statement is itself the finding** | Live chart, creating 10,000 labels on one bar |

### 8.7 Semantics not stated (U48–U53)

| # | Open question | What it blocks | How to settle |
|---|---|---|---|
| U48 | Whether **`polyline.new()` copies** its `points` array and the `chart.point` objects in it, or holds a live reference | Whether mutating the array after the call alters the drawing. `box.new()`/`label.new()`/`line.new()` are documented to copy; `polyline.new()` is documented **neither way**. A real renderer decision point | Live chart, mutating a point after creating the polyline |
| U49 | Whether `fill_color` **requires `closed = true`** | Fill of an open path. `[UM]`'s phrase "the closed space filled by the polyline" hints at implicit closure, but never says so | Live chart with `closed = false` + `fill_color` |
| U50 | **Fill rule for self-intersecting polylines** — nonzero or even-odd winding | Self-intersecting polygon fills | Live chart with a figure-eight |
| U51 | Whether **`table.cell_set_*()` on a coordinate never passed to `table.cell()`** creates the cell with defaults, or is a no-op | Table cell lifecycle. Only `table.merge_cells()` is documented as exempt from the "define first" rule; no error page covers the setter case. Safe design: implement one behaviour **behind a flag**, and log | Live chart |
| U52 | **Z-order across plot types within one script** — a `plot()` line vs a `plotshape()` mark vs a `plotcandle()` body, all in bucket 3 | Intra-bucket ordering for mixed plot types. Source order is documented for `plot()` calls; nothing states the rule across types | Live chart with all three overlapping |
| U53 | **Panes per chart / scripts per chart** | Nothing in the renderer, but engineers ask. Not documented in the Pine docs at all. The nearest facts are `[HC]`, about *script chaining*: "cannot rely on more than **10** indicators connected in a sequence", plus an "indicator-on-indicator limit of **24** connections". Per-plan indicator counts are a subscription feature — **do not state a number** | Not a Pine language question |

**53 UNVERIFIED entries.** The concentration is deliberate and informative: **U1–U13 (geometry) and
U33–U36 (clipping/autoscale) together are ~30% of the register**, which means a renderer can be fully
conformant to every documented behaviour in §7 and still be visibly wrong. Budget for a differential
screenshot harness against the real product; the documentation cannot close these.

---

## 9. Documentation defects found

These matter because an engineer who reads TradingView's prose docs and skips this section will
implement the wrong thing. Each row states the defect and the resolution this spec adopts.

### 9.1 Reference vs User Manual — outright contradictions

| # | Family | Reference | User Manual | Resolution |
|---|---|---|---|---|
| **D1** | `label.style_*` | **21** members | *"These are the available style arguments:"* then a **20-row** table — omits **`label.style_text_outline`** (added Aug 2022 `[RN]`), which appears on **zero** of 49 manual pages | **21.** Implement `label.style_text_outline`: outlined text, no balloon |
| **D2** | `plot.style_*` | **11** members, enumerated in `plot(style=)`'s own description | *"The available arguments are:"* then names **9** — omits **`plot.style_stepline_diamond`** (named elsewhere on the same page) **and `plot.style_steplinebr`**, which appears on **zero** manual pages | **11.** Both styles are real; their detailed semantics are U8 |
| **D3** | `color.blue` | **`#2962ff`** (v6 **and** v5 payloads agree) | `#2196F3` (Material Blue 500) in the prose colour table | **`#2962ff`.** Note the payload's lowercase hex for this one constant — compare case-insensitively |
| **D4** | `plotcandle()` signature | **14** parameters | `/visuals/bar-plotting/` publishes **11** — `plotcandle(open, high, low, close, title, color, wickcolor, editable, show_last, bordercolor, display)`, missing `format`, `precision`, `force_overlay` | **14.** The published signature is stale |
| **D5** | `location.*` | **5** members, all 5 listed for both `plotshape` and `plotchar` | `/visuals/text-and-shapes/` lists only `abovebar`/`belowbar`/`top` — omits **`location.bottom` and `location.absolute`**, and `location.absolute` is the one with different y semantics | **5.** The omitted constant is the behaviourally distinctive one |
| **D6** | `fill()` / `bgcolor()` signatures | `fill()` has **3** overloads and a `display` parameter; `bgcolor()` has `display` | `[UM]` shows **2** `fill()` overloads (no gradient) and omits `display` from both signatures | Reference. `[UM]`'s signatures are stale |

### 9.2 Reference-internal defects and inconsistencies

| # | Defect | Resolution |
|---|---|---|
| **D7** | **`fill()`'s gradient overload types `plot1`/`plot2` as `plot` only**, and the payload contains **no** hline-gradient overload — yet the reference's **own example** for `fill()` is titled *"Gradient fill between two horizontal lines"* and passes two `hline()` results; `[BLOG]` declares both gradient overloads; `[UM FAQ]` ships `fill(h2, h1, 30, 5, …)` over hline ids | **Accept `(hline, hline, num, num, color, color)`.** The single-`plot` typing is a payload defect, not the language rule |
| **D8** | **`plot(display=)`'s possible-values list omits `display.pine_screener`** (it names none/pane/data_window/price_scale/status_line/all) while the **`display.pine_screener` constant itself** says it is *"for use with the `display` parameter of the `plot()` function"* | The constant is the more specific statement. `display.pine_screener` is valid on `plot()` and only `plot()`; the parameter's list is incomplete |
| **D9** | **`text_wrap`'s description is self-referential**: *"If the `text_size` is 0 **or `text.wrap_auto`**, this setting has no effect"* — comparing `text_wrap` against `text.wrap_auto` inside `text_wrap`'s own description | The `text_size == 0` half is coherent and is treated as authoritative (§4.5.4). **The second clause's intent is unknown** and is not implemented |
| **D10** | **`indicator()` vs `strategy()` describe the same `max_*_count` parameters differently.** `indicator()`: *"The default is ~50 … the limit … is approximate; the script might display more drawings than specified"*, **no range**. `strategy()`: *"Possible values: 1-500. Optional. The default is 50."*, **no approximate clause** for lines/labels/boxes — but polylines **do** get *"Possible values: 1-100. The count is approximate"* | **Default ~50, settable 1–500 (1–100 polylines), enforcement approximate.** `[UM]`'s own "Only the last **54** labels are displayed" example corroborates `indicator()`, not `strategy()` |
| **D11** | **`max_bars_back` differs between declarations.** `indicator()`: *"must be an integer **from 0 to 5000**"*, auto-computed by default. `strategy()`: *"**The default is 0**"*, no range stated | Use `indicator()`'s statement: range 0–5000, auto-computed when unset |
| **D12** | **The 500-bar-future note is applied inconsistently.** It appears on **17** payload entries including `line.set_x1`, `line.set_x2`, `line.set_xy1`, `box.set_left`, `box.set_right`, `label.set_x`, `label.set_xy` — but **not** on `line.set_xy2`, nor on `line.set_xloc` / `box.set_xloc` / `label.set_xloc` | A documentation gap, not a behavioural difference. Treat the bound as **global to `xloc.bar_index`** |
| **D13** | **`size.auto`'s own blurb lists `plotchar()`, `plotshape()`, `label.new()`, `box.new()` but NOT `table.cell()`** — while `table.cell(text_size=)`'s parameter doc **does** list `size.auto (0)` among its accepted values | The parameter doc is the more specific statement; `size.auto` is accepted by `table.cell()` |
| **D14** | **`[UM]` claims a "second overload of `chart.point.from_index()`"** — that function has **exactly one** signature in the payload (verified: no overload marker, single `syntax` line) | Docs error. There is no second overload to implement |
| **D15** | **`table.cell()` says `width`/`height` are *"a % of the indicator's visual space"*; `table.cell_set_width()`/`_set_height()` say *"a % of the chart window"*** | Same mechanism, two phrasings. Treat as **% of the script's own pane**, corroborated by `[UM]`'s `width = 100, height = 100` example filling the pane from `position.middle_center` |
| **D16** | **`table.set_frame_width`'s description contains a grammatical typo** in the official reference: *"The function set the width of the outer frame of a table."* | Cosmetic; noted so a reader does not think the extraction corrupted it |

### 9.3 Coverage omissions in the User Manual (from the 239-constant × 49-page sweep)

Not contradictions — the manual simply never covers these. Recorded because "not in the manual" is
routinely misread as "not in the language".

| # | Family | Reference | Named anywhere in 49 manual pages |
|---|---|---:|---|
| **D17** | `display.*` | 7 | **5** — `display.price_scale` and `display.pine_screener` appear on **no** manual page, yet the overview page discusses price-scale visibility in prose and the reference documents the `display.all - display.price_scale` idiom |
| **D18** | `math.*` | 4 | 1 — only `math.pi`; `math.phi`, `math.rphi`, `math.e` appear nowhere |
| **D19** | `currency.*` | 56 | 6 — 50 of 56 appear nowhere |
| **D20** | `adjustment.*` | 3 | 1 — only `adjustment.dividends` |
| **D21** | `strategy.direction.*` | 3 | 1 — only `.long`; `.all` and `.short` are reference-only |
| **D22** | `settlement_as_close.*` | 3 | **0** — entire family absent |
| **D23** | `backadjustment.*` | 3 | **0** — entire family absent |
| **D24** | `strategy.commission.*` | 3 | 2 — `cash_per_order` absent from every page |
| **D25** | `format.*` | 5 | `format.mintick` is missing from the declaration-statements `format` list (it is documented elsewhere, under string formatting) — a per-page enumeration gap only |

**Families checked with no disagreement:** `line.style_*` 6/6, `hline.style_*` 3/3, `extend.*` 4/4,
`xloc.*` 2/2, `yloc.*` 3/3, `shape.*` 12/12, `size.*` 6/6 including both int tables, `position.*` 9/9,
`text.align_*` 5/5, `text.format_*` 3/3, `text.wrap_*` 2/2, `font.family_*` 2/2, `color.*` 17/17,
`dayofweek.*` 7/7, `barmerge.*` 4/4, `alert.freq_*` 3/3, `scale.*` 3/3, `location.*` 5/5 (in the
reference; see D5 for the manual's page-level omission), `session.*` 2/2, `earnings.*` 3/3,
`dividends.*` 2/2, `splits.*` 2/2, `strategy.oca.*` 3/3, `order.*` 2/2.

### 9.4 Figures that exist in only one source

Not defects, but single-sourcing that a reader should know about before treating a number as bedrock.
**Verified by full-payload search:** the string "10,000"/"10000" appears **nowhere** in the reference
payload in connection with drawings — the only matches are `initial_capital = 1000000`.

| Figure | Where it appears | Where it does **not** |
|---|---|---|
| Polyline **10,000-point** cap | `[UM]` (twice) and `[RN]` | The reference — `polyline.new` has **no `remarks` block at all** |
| **`bar_index - 10000`** backward x floor | `[UM]` | The reference |
| **500 / 500 / 500 / 100** id maxima | `[UM]` and `strategy()`'s argument descriptions | `indicator()`'s argument descriptions, which state the ~50 default but no valid range |
| **Plot-count arithmetic** (64 total, 7 per call, which functions count, the qualifier thresholds) | `[UM]` only | The reference has no plot-count data at all |
| **9-table** cap | `[UM]` | The reference (it is derivable from the 9 `position.*` constants, but never stated) |
| `line.new()` defaults `color.blue` / `line.style_solid` / `1` | `[UM]` | The reference states **no default** for `color`, `style` or `width` — unlike `box.new()`, whose equivalents it does state |

### 9.5 Two corrections to the input research, for the record

| # | Claim in an input lane | Payload finding | Correction |
|---|---|---|---|
| **L1** | `box.new()`'s **overload-2 coordinate arguments** (`left`, `top`, `right`, `bottom`) are *"absent from the v6 reference's ARGUMENTS block"*, so their types were marked "strongly inferred" from the parallel setters | The payload carries a distinct **19-argument** `box.new` entry with all four, fully described: `left (series int)`, `top (series int/float)`, `right (series int)`, `bottom (series int/float)` | **Upgraded to VERIFIED from the reference.** The lane's browser-DOM scrape read only overload 1's argument block |
| **L2** | *"14 distinct functions"* accept `force_overlay` (while the same lane's own enumeration listed 12) | Enumerating every argument list in the payload yields **12** functions and **0** methods | **12**: `plot`, `plotshape`, `plotchar`, `plotarrow`, `plotbar`, `plotcandle`, `bgcolor`, `box.new`, `line.new`, `label.new`, `polyline.new`, `table.new` |

Also worth recording as a **source warning**: the third-party
`iamrichardD/mcp-server-pinescript` `docs/processed/language-reference.json`, which some tooling links
as a Pine reference, contains **457 functions and zero `table.*` entries**. It is incomplete and was not
used.

### 9.6 Access defects (why the extraction recipe exists)

| Problem | Consequence |
|---|---|
| `pine-script-reference/v6/` is a **client-rendered SPA** — a plain fetch returns a ~129 KB shell with zero reference content; `#fun_plot`, `#fun_label.new`, `#const_plot.style_line` anchors resolve client-side and are not separately fetchable; candidate JSON endpoints (`index.json`, `reference.json`, `/api/…`) all **404** | The webpack-chunk extraction in §1.2 is the only complete path. Hash-pinned URLs rot on redeploy; the recipe is durable |
| Every `/pine-script-docs/concepts/…` URL **301-redirects** to `/pine-script-docs/visuals/…`; a summarising fetcher against the `/concepts/` paths returns only a redirect notice | Any citation of a `/concepts/` URL in older material is stale |
| A summarising fetch of `/visuals/fills/` came back **lossy** — it silently dropped the gradient overload and the `fillgaps` text entirely | Prose pages must be read as raw HTML and tag-stripped, never through a summariser |
| Manual `label.style_*` / `line.style_*` / `shape.*` tables render appearance as **images with no alt text** | Per-style geometry cannot be sourced from documentation at all — the root cause of U1, U2, U6 |
| **143 i18n string ids** in one extraction pass could not be resolved from the four language chunks (one was the body of `explicit_plot_zorder`'s description, substituted from `[UM]`); a second, independent extraction resolved **0 unresolved strings** | The two extractions were cross-checked and agree on every presentation entry; the resolved one is the basis of this document |

---

*End of specification. 214 conformance items (§7), 53 UNVERIFIED entries (§8), 25 documentation defects
plus 2 input-research corrections (§9). Authority: TradingView's own v6 reference payload, extracted
2026-09-08. No claim was confirmed by running Pine on a live chart.*
