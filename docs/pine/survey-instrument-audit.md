# Lane 1 — Adversarial audit of the mechanical presentation-primitive survey

**Target:** `acq/inventory.json` → `acq/agg_presentation.json` / `acq/table_presentation.md`
(n = 1,443 open-source TradingView scripts).
**Question:** can the demand table be trusted, in which direction does it err, and by how much per primitive?

**Answer in one line:** the counter is *arithmetically exact for what it looks at* (I replicated all 1,443
scripts with **zero** disagreements) but it is **blind to Pine's method-call syntax, to library calls, and to
runtime multiplicity**. The table is a **net UNDERCOUNT of ~+17% on call sites overall, and the error is
wildly non-uniform**: the `plot` family and the `*.new` constructors are **exact (0% error)**, while
**setters are −56%, getters −104%, deletes −24%**, and 1,196 (script, primitive) coverage pairs are missing
entirely — which moves the `% of scripts` column that the table is *sorted by*.

---

## 0. Method (so the numbers can be re-derived)

1. **Byte-for-byte replication.** I copied `strip_noise`, `arg_list`, `split_top` and the
   `(?<![\w.])name\s*\(` matcher out of `acq/inventory.py` into
   `scratchpad/lane1/audit_core.py` (I never ran or imported the acq scripts) and re-analysed all
   1,443 sources. **Result: 0 differences** across every presentation primitive, every `_setters` key and
   every script. So every number below is about what the scanner *cannot see*, never about its arithmetic.
2. **Extra detectors added:** method-call syntax with receiver typing; loop/conditional nesting by
   indentation walk; multi-line argument detection; import-alias call detection; chained-call detection;
   UDT/enum/user-method exclusion; quote-parity desync check; duplicate-source hashing.
3. **Ground truth for "what should exist":** `scratchpad/v6ref.json` (719 functions, 251 methods) —
   used to build the authoritative *method name → owner type* map, and to prove which primitives the
   inventory's hard-coded list omits.
4. **Hand verification:** 30-script stratified sample, plus direct reading of source lines for every
   claimed disagreement class.

Working files: `scratchpad/lane1/{audit_core,run_corpus,probe2..probe5,final_numbers,categorize,build_outputs}.py`,
`corpus_audit.json`, `method_syntax_final.json`, `final_numbers.json`, `sample_report.txt`.

---

## 1. TASK A — the stratified sample of 30

`inv sites` = inventory's presentation total incl. `_setters`. `my sites` = my independent re-count.
`replicated` = the two agree. The real finding is in the last three columns.

| # | stratum | script | v | KB | inv sites | my sites | replicated | hidden method-form | loop-nested | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | longest | `ichimoku-kinko-hyo-一目均衡表__a8a2aa1034` | 6 | 228 | 41 | 41 | yes | **118** | 17 | UNDER: 49 invisible `t1.cell()` + 11 `merge_cells` |
| 2 | longest | `ultra-market-structure__8116de58a6` | 6 | 198 | 356 | 356 | yes | 0 | 10 | sites ≠ objects (2 fib loops) |
| 3 | longest | `ict-master-suite-trading-iq__089c889b52` | 5 | 151 | 151 | 151 | yes | **98** | 49 | UNDER + 24 `chart.point` sites in loops |
| 4 | longest | `quadapt-machine-learning-trader__31769abc05` | 6 | 146 | 92 | 92 | yes | 6 | 13 | UNDER (6 `box.set_right`) |
| 5 | draw-heavy | `silen039s-pseudo-vpvr…__rVQ30pHV5p` | 4 | 67 | 181 | 181 | yes | 0 | 0 | **EXACT** (181 unrolled `line.new`) |
| 6 | draw-heavy | `all-chart-patterns-theeccentrictrader__03e4633d31` | 6 | 50 | 488 | 488 | yes | 0 | 0 | exact locally, but 50 calls into 2 imported libs |
| 7 | draw-heavy | `multi-timeframe-harmonic-patterns__b04106e51f` | 5 | 108 | 364 | 364 | yes | 0 | 0 | **EXACT** |
| 8 | draw-heavy | `market-structure-zig-zag-bos…__4758e6c88f` | 6 | 93 | 170 | 170 | yes | 0 | 8 | sites ≠ objects |
| 9 | draw-heavy | `mtf-key-levels-support-and-resistance__29f470a089` | 4 | 37 | 160 | 160 | yes | 0 | 0 | **EXACT** |
| 10 | method-syntax | `support-and-resistance-signals-mtf-luxalgo__557d322377` | 5 | 34 | 56 | 56 | yes | **238** | 0 | UNDER 4.3× — table shows 0 setters/getters |
| 11 | method-syntax | `breaker-blocks-with-signals-luxalgo__d17c8beda1` | 5 | 40 | 21 | 21 | yes | **160** | 4 | UNDER 7.6× |
| 12 | method-syntax | `elliott-wave-luxalgo__c2e3f3c9ab` | 5 | 27 | 48 | 48 | yes | **138** | 1 | UNDER 2.9× |
| 13 | method-syntax | `ict-concepts-luxalgo__de59cffec5` | 5 | 50 | 45 | 45 | yes | **132** | 0 | UNDER 2.9× |
| 14 | method-syntax | `open-interest-chart-luxalgo__1a35255035` | 5 | 76 | 26 | 26 | yes | **142** | 0 | UNDER 5.5× (incl. only `linefill.get_line*` sites in corpus) |
| 15 | table | `ict-validated-smc-v18__789a5c79bf` | 6 | 95 | 228 | 228 | yes | 0 | **81** | sites ≠ objects (while+for pools) |
| 16 | table | `sessions-full-markets-tradingfinder…__5e1c84827f` | 6 | 27 | 57 | 57 | yes | 0 | 0 | **EXACT** |
| 17 | table | `adaptive-ichimoku-nexus-willyalgotrader__c4b4ab6158` | 6 | 74 | 148 | 148 | yes | 0 | 0 | **EXACT** |
| 18 | legacy | `squeeze-momentum-indicator-lazybear__175` | none | 1 | 2 | 2 | yes | 0 | 0 | **EXACT** |
| 19 | legacy | `wavetrend-lazybear__1` | none | 1 | 8 | 8 | yes | 0 | 0 | **EXACT** |
| 20 | legacy | `cm-macd-ult-mtf__40` | none | 3 | 5 | 5 | yes | 0 | 0 | **EXACT** |
| 21 | legacy | `fibonacci-bollinger-bands__2835` | none | 1 | 13 | 13 | yes | 0 | 0 | **EXACT** |
| 22 | legacy | `volume-flow-indicator-lazybear__128` | none | 1 | 4 | 4 | yes | 0 | 0 | **EXACT** |
| 23 | legacy | `4-colour-macd__1146` | none | 1 | 2 | 2 | yes | 0 | 0 | **EXACT** |
| 24 | legacy | `bollinger-rsi-double-strategy-by-chartart-v11__2187` | 2 | 3 | 6 | 6 | yes | 0 | 0 | **EXACT** |
| 25 | v6-modern | `smart-money-breakout-channels-algoalpha__8c2d234156` | 6 | 15 | 12 | 12 | yes | 2 | 1 | UNDER (2 deletes) |
| 26 | v6-modern | `opening-range-with-breakouts-targets-luxalgo__6261008975` | 6 | 13 | 14 | 14 | yes | **31** | 4 | UNDER 3.2× |
| 27 | v6-modern | `trend-targets-algoalpha__92ff5628d7` | 6 | 10 | 68 | 68 | yes | 0 | 0 | **EXACT** |
| 28 | v6-modern | `volumatic-variable-index-dynamic-average-bigbeluga__04a9de6fcd` | 6 | 9 | 16 | 16 | yes | 0 | 2 | sites ≠ objects |
| 29 | v6-modern | `candlestick-patterns-identified-update-1-17-26__1082` | 6 | 6 | 15 | 15 | yes | 0 | 0 | **EXACT** |
| 30 | imports | `breaker-blocks-order-blocks-overlap-ict-tradingfinder-bbob__7ade4111ca` | 5 | 69 | **0** | 0 | yes | 0 | 0 | **TOTAL BLINDNESS** — see §2.3 |

**Sample tally:** 14 fully exact · **10 undercounted by method-call syntax** (1,065 invisible sites in those
10 scripts, against the 506 sites the inventory *did* record for the same 10 — i.e. the truth is 3.1× the
recorded figure there) · 4 where the site count is right but "call sites ≠ objects on screen" · 1 (#30) where
the entire drawing surface is invisible behind library imports · 1 (#6) with partial library leakage.
Every sampled script replicated exactly, so **there is not a single arithmetic disagreement in the sample —
all 16 disagreements are coverage failures**, listed and quantified next.

---

## 2. Every disagreement class, ranked by impact

### 2.1 (impact #1) METHOD-CALL SYNTAX — `myBox.set_right(x)` is invisible

Pine v5+ lets every drawing-object function be called as a method on a variable. `inventory.py` only
matches `label.set_text(`/`line.delete(` at the *namespace*, so `l.set_text(...)` and `bx.delete()` are
never seen.

**Corpus-wide, defensible ("tier A") count: 4,429 invisible call sites in 281 scripts (19.5% of the corpus).**

| family | inventory | hidden (method form) | hidden (chained, §2.4) | corrected | error |
|---|---|---|---|---|---|
| `plot`/`plotshape`/`fill`/`hline`/`bgcolor`/`barcolor`/… | 9,444 | 0 | 0 | 9,444 | **0% — exact** |
| drawing constructors `*.new` | 8,195 | 0 | 0 | 8,195 | **0% — exact** |
| setters `*.set_*` | 4,343 | 2,151 | 282 | 6,776 | **−56%** |
| getters `*.get_*` | 1,332 | 1,182 | 208 | 2,722 | **−104%** |
| deletes `*.delete` | 3,582 | 592 | 282 | 4,456 | **−24%** |
| `table.*` (all) | 2,774 | 504 | 0 | 3,278 | **−18%** |
| `chart.point.*` | 584 | 0 | 0 | 584 | 0% |
| **whole table** | **29,940** | **4,429** | **772** | **35,141** | **−17.4%** |

Constructors are exact for a *language* reason, not luck: `label.new()` has no method form, and
`plot()`/`fill()`/`hline()` **must** be called in global scope. Empirically confirmed twice: **0 of 9,444
plot-family sites are block-nested**, and only 10 of them (0.11%) even sit on an indented line — all 10 are
cosmetic column alignment at global scope, not nesting. So for the plot family **1 call site = 1 rendered
series, exactly**. **This is why the top of the demand table is trustworthy and the middle of it is not.**

Worst individual rows (inventory sites → corrected):

| primitive | inventory | hidden | corrected | understated by |
|---|---|---|---|---|
| `box.set_border_style` | 2 | 23 | 25 | **+1150%** |
| `linefill.set_color` | 12 | 23 | 35 | +192% |
| `line.get_y2` | 83 | 152 | 235 | +183% |
| `box.get_left` | 74 | 132 | 206 | +178% |
| `box.get_top` | 221 | 294 | 515 | +133% |
| `polyline.delete` | 37 | 49 | 86 | +132% |
| `box.set_right` | 263 | 292 | 555 | +111% |
| `line.set_x2` | 533 | 351 | 884 | +66% |
| `table.cell` | 2,285 | 360 | 2,645 | +16% |
| `linefill.get_line1/2` | **0** | 29 + 29 | 58 | **row missing entirely** |
| `table.cell_set_bgcolor` / `_text` / `_tooltip` | **0** | 27 / 20 / 22 | 69 | **rows missing entirely** |

Hand-verified examples:
* `support-and-resistance-signals-mtf-luxalgo` line 237: `if pp.h < lR.bx.get_bottom() * … or pp.h > lR.bx.get_top() …`
  — `bx` is a `box` field of `type SnR`. 238 such calls; the table records **zero** setters/getters for this
  20,018-like script.
* `ichimoku-kinko-hyo` line 3884: `var table t1 = table.new(…)` then 49 × `t1.cell(0, row, …)`.
  The table credits this script with `table.new`=1 and `table.cell`=**0**.

**Caveat I insist is kept with this number.** A naive `X.method(` regex over-counts badly: it picks up
1,352 UDT constructors (`type Foo` … `Foo.new()`), 293 `arr.clear()`, 75 `arr.copy()`, 138
`LibAlias.Type.new()` and 87 user-redefined `method delete/clear/set_y/cell`. My first pass returned 6,423;
after excluding those and refusing to attribute names shared with non-drawing namespaces
(`.new`, `.copy`, `.clear` on untyped receivers — 390 sites parked as unattributable) the defensible figure
is **4,429**. Anyone re-deriving this must apply the same exclusions or they will inflate `table.clear`
from 30 to 314 (the real hidden count is 6).

### 2.2 (impact #2) CALL SITES ARE NOT OBJECTS ON SCREEN

The tool counts *call sites*. A single site inside a loop creates N objects per bar.

| primitive | sites | inside a loop | inside a conditional | literal-bound loops | dynamic-bound loops |
|---|---|---|---|---|---|
| `box.new` | 1,274 | **403 (32%)** | 776 (61%) | 19 → 652 objects (avg ×34) | 365 (unbounded) |
| `line.new` | 3,405 | 497 (15%) | 2,450 (72%) | 47 → 3,812 (avg ×81) | 374 |
| `label.new` | 2,852 | 376 (13%) | 2,060 (72%) | 18 → 11,100 (avg ×617) | 328 |
| `table.cell` | 2,285 | 112 (5%) | 1,975 (86%) | 22 → 204 (avg ×9) | 70 |
| `polyline.new` | 153 | 26 (17%) | 103 (67%) | 0 | 23 |
| `linefill.new` | 204 | 28 (14%) | 132 (65%) | 2 → 39 | 26 |

So **"1,274 `box.new` call sites"** does **not** mean 1,274 boxes. The right ceiling is the one the authors
themselves declare: `max_boxes_count` is set in 323 scripts with a **mean of 496**, and the corpus reserves
**155,823 boxes / 196,105 labels / 213,709 lines / 4,290 polylines**. A renderer sized off "8,195
constructors" is sized 1–2 orders of magnitude too small.

Tables are the extreme case: **254 scripts declare 143,187 grid cells but contain only 2,645 `cell()` call
sites — a 54× gap**, because the heatmap idiom is a 100×100 table filled by 4 sites in a nested loop
(`volatility-gaussian-bands-bigbeluga`: grid 20,000, sites 4; `stop-loss-clustering-breakouts-kioseff`:
grid 19,602, sites 27).

### 2.3 (impact #3) IMPORTED LIBRARIES — whole scripts read as zero

`import user/lib/1 as L` then `L.draw()` is completely invisible. **123 scripts (8.5%) import; 94 of them
make 782 alias calls.** The tool's own data proves the loss:

* **62 scripts declare `max_labels_count` but show zero `label.new`; 63 declare `max_lines_count` with zero
  `line.new`; 36 declare `max_boxes_count` with zero `box.new`; 8 declare `max_polylines_count` with zero
  `polyline.new`.**
* **27 scripts reserve drawing capacity and contain no drawing constructor at all.** The cleanest case is
  sample #30: `breaker-blocks-order-blocks-overlap-ict-tradingfinder-bbob`, 70 KB, 7,592 likes, declares
  `max_boxes_count=500, max_labels_count=500, max_lines_count=500`, and contributes **0** to every row of
  the demand table. Its drawing is 6 × `Drawing.OBDrawing(...)` + 18 × `OLB.OBOverlappingDrawing(...)`.
  The same pattern covers 4 more TradingFinder ICT scripts, `auto-chart-patterns-trendoscope`,
  `machine-learning-rsi-zeiierman`, `wavetrend-3d`, and others.

### 2.4 (impact #4) CHAINED CALLS ON COLLECTION ACCESSORS — invisible to *both* scanners

`boxes.get(i).delete()` / `arr.pop().set_x2(n)`: the receiver is a call result, so neither the inventory's
regex nor my receiver-typed detector matches it. Restricting to drawing-exclusive method names:
**772 extra sites**, dominated by `.delete` (282), `.set_x2` (51), `.get_top` (45), `.get_y2` (39),
`.set_xy2` (38), `.get_bottom` (38), `.set_right` (36). These are already included in the corrected column
above, and they mean **4,429 is a floor, not a point estimate**.

### 2.5 (impact #5) ENUMERATION GAPS — primitives the list simply does not contain

Checked exhaustively against `v6ref.json`. Of the official v6 presentation-namespace functions,
18 are counted nowhere by `inventory.py`. Real namespace-form usage in the corpus:

* **`linefill.delete` — 50 sites in 26 scripts, absent from the table** (the `_setters` regex only matches
  `set_`/`get_`, and `PRESENTATION` lists `polyline.delete`/`table.delete` but forgot `linefill.delete`).
* **`table.cell_set_*` (14 functions) — absent from the table by construction**, because the setter regex
  requires the name to *start* with `set_`. Namespace-form usage is small (9 sites) but the method form is
  not: 27 `cell_set_bgcolor`, 22 `cell_set_tooltip`, 20 `cell_set_text`.
* `line(`/`box(`/`label(` (411 sites, mostly `line(na)`) are **correctly** excluded — they are type casts,
  not drawing. Verified: 271 of them are literally `line(na)`.

### 2.6 (impact #6) GETTERS ARE COUNTED AS "SETTERS"

The `_setters` bucket (and therefore rows like `box.get_bottom`, `line.get_price` in the demand table) mixes
two different demands. **1,332 of 5,675 sites (23%) are read-only getters.** A getter is a *model-read* API
(`box.get_top()` to test containment), not a renderer feature. Reading the table as "renderer work to build"
overstates it by that 23%; reading it as "object-model surface" is fine. The distinction matters because
getters are the fastest-growing hidden family (−104% understated), i.e. the corpus uses drawing objects as a
**queryable data structure**, not only as pixels.

### 2.7 (impact #7) THE ONE REAL OVERCOUNT: plots that are never drawn

**557 of 4,898 `plot()` sites (11.4%) declare `display = display.none` or data-window-only** — they exist to
carry alert/screener values, not to render. Same for 33 `plotshape`, 28 `fill`, 11 `plotcandle`, 4 `plotchar`.
So `plot`'s 4,898 sites overstate *render* demand by ~11% while understating nothing.

### 2.8 (impact #8) `fill()` LUMPS FOUR DIFFERENT RENDERER FEATURES

1,225 `fill` sites in one row hide: plot-pair fill, hline-pair fill, **gradient fill** (`top_color`/
`bottom_color`/`top_value`/`bottom_value`, 61 sites), and the 6–7-positional-arg form (188 sites).
Positional arity histogram: `{0:35, 2:607, 3:281, 4:108, 5:6, 6:169, 7:19}`. A build plan that reads
"fill = 31.3% of scripts, one feature" will under-scope by one whole renderer capability (vertical gradient
fill between two series).
Note the *linkage* question resolves fine: `p1 = plot(...)` … `fill(p1, p2)` **is** counted (607 sites at
arity 2, plus 35 fully-named `plot1=`/`plot2=`); what is lost is only *which* plots, not the fill itself.

### 2.9 Things I expected to be broken and found sound

* **Comment stripping is exact.** `silen…vpvr` contains 186 textual `line.new`; 5 are commented out;
  inventory reports 181. Verified by hand.
* **Multi-line / wrapped arguments are handled correctly.** 2,591 call sites in the corpus have newlines
  inside the argument list (768 `label.new`, 516 `line.new`, 382 `box.new`, 265 `table.cell`) and the
  balanced-paren extractor gets all of them; named-arg extraction survives the wrap.
* **String-content stripping never desyncs.** 0 of 1,443 scripts end with odd quote parity.
* **Primitives inside user-defined functions are counted** (63.8% of scripts define UDFs, 9.6% define
  `method`s) — the text scan finds the call site wherever it is. What is *not* counted is how many times
  that UDF is invoked, which is the §2.2 problem again.
* **Legacy v1–v3 `study()` scripts are handled correctly** (7/7 in the sample exact). Version mix:
  v5 = 553, v6 = 400, v4 = 244, v1–v3 = 86 by `@version`, plus 160 with no `@version` annotation at all.

### 2.10 Corpus-integrity issues (not counting bugs, but they change the denominators)

* **The inventory is a stale snapshot.** `sources/` now holds **2,155** `.pine` files; `inventory.json`
  covers **1,443** (67%). The acquisition was still running when the aggregate was written
  (`fetch_log.json` 22:47 vs `inventory.json` 22:43). Every absolute count in the table is ~⅓ short of the
  material already on disk; percentages are only valid if the remaining 712 are distributionally identical,
  which nobody has checked.
* **2 duplicate sources** (`custom-screener-with-alerts` ×2, `wavetrend-oscillator-krypt` ×2) are counted
  twice — 0.14%, ignorable, but it means slug ≠ script identity.
* **No `library()` declarations in the corpus at all** (indicator 925 / study 440 / strategy 78). So the
  survey measures *consumers* of drawing libraries and never the libraries themselves — while 8.5% of
  consumers delegate their drawing into exactly those unmeasured libraries.
* `agg_constants.json` counts function names as constants (`label.new`, `color.new`, `box.new` appear in the
  "constants" table because `CONST_NS` and the drawing namespaces overlap). Out of scope here, but do not
  read that file as an enum-value demand table without filtering `(`-followed names.

---

## 3. Verdict: is the demand table trustworthy?

**Trust it for three things, and correct it for everything else.**

| region of the table | direction | magnitude | verdict |
|---|---|---|---|
| `plot`, `plotshape`, `plotchar`, `plotarrow`, `plotcandle`, `plotbar`, `hline`, `bgcolor`, `barcolor`, `fill` — sites & named args | exact, except a **−11% overcount** of *rendered* plots (`display.none`) | ±0% on sites | **TRUSTWORTHY**; split `fill` into 4 features before scoping |
| `label.new` / `line.new` / `box.new` / `polyline.new` / `linefill.new` / `table.new` — **call-site** counts and **named-arg demand** | exact | ±0% | **TRUSTWORTHY as an API-shape signal** |
| the same rows read as **object counts** | undercount | **10×–100×** (declared ceilings: mean 496 boxes, 459 labels, 458 lines per script) | **DO NOT USE for capacity/perf sizing** |
| every `*.set_*` row | undercount | **−56%** aggregate, −1150% worst row | **CORRECT BEFORE USE** |
| every `*.get_*` row | undercount | **−104%** | **CORRECT BEFORE USE** |
| every `*.delete` row | undercount | **−24%** | correct before use |
| `table.cell` / `table.merge_cells` / `table.clear` | undercount | −16% / −51% / −20% sites; **−54× on cells rendered** | correct before use |
| `linefill.delete`, `linefill.get_line1/2`, `table.cell_set_*` | absent | rows missing | **add the rows** |
| the `% of scripts` column (the sort key) | undercount | **1,196 missing (script, primitive) pairs**; e.g. `line.set_x2` 7.9% → **13.7%**, `box.set_right` 5.9% → **10.6%**, `box.get_top` 4.0% → **7.8%**, `table.cell` 13.9% → **17.0%**, `line.delete` 20.4% → **23.8%** | **RANKING IS WRONG, not just the magnitudes** |
| any per-script or per-category *absolute* total | undercount | corpus is 1,443 of 2,155 fetched (67%) | re-run before quoting absolutes |

**Method-call-syntax undercount estimate (the headline number):**
**4,429 defensible invisible call sites, +772 chained = 5,201, i.e. +17.4% on the whole table and
+56%/+104%/+24% on setters/getters/deletes, concentrated in 281 scripts (19.5%) — and that is a floor.**
It is not spread evenly: **LuxAlgo-, TradingIQ- and ICT-toolkit-style v5/v6 UDT code is where it all lives**
— the top 8 scripts hide 1,121 sites (25% of the total), 6 of the 8 are LuxAlgo — so the table
systematically under-weights exactly the modern, object-model-heavy scripts a new engine would be judged
against.

---

## 4. Category cross-tab (full data in `lane1-categories.json`)

Distribution over 1,443 scripts and the drawing demand each category drives:

| category | n | % corpus | draw ctors / script | plot-family / script | share of all drawing sites | hidden method sites | loop-nested sites |
|---|---|---|---|---|---|---|---|
| market-structure/smart-money | 305 | 21.1% | **10.9** | 3.4 | **40.6%** | 1,972 (45%) | 513 |
| order-flow | 128 | 8.9% | 9.3 | 5.1 | 14.6% | 506 | 395 |
| support-resistance | 164 | 11.4% | 7.1 | 6.4 | 14.1% | 809 | 131 |
| momentum | 216 | 15.0% | 1.9 | 9.0 | 5.0% | 49 | 76 |
| mtf-dashboard | 43 | 3.0% | 8.0 | 9.8 | 4.2% | 114 | 42 |
| trend | 217 | 15.0% | 1.6 | 7.6 | 4.2% | 226 | 46 |
| session-tools | 37 | 2.6% | 8.7 | 5.5 | 3.9% | 150 | 35 |
| machine-learning-styled | 57 | 4.0% | 4.9 | 6.9 | 3.4% | 98 | 44 |
| volatility | 73 | 5.1% | 2.8 | 9.2 | 2.5% | 108 | 17 |
| volume | 79 | 5.5% | 2.3 | 7.6 | 2.2% | 56 | 37 |
| risk-position | 47 | 3.3% | 2.9 | 6.2 | 1.7% | 102 | 38 |
| harmonic-patterns | 13 | 0.9% | **9.2** | 5.4 | 1.5% | 147 | 15 |
| candlestick-patterns | 27 | 1.9% | 2.9 | 5.5 | 1.0% | 6 | 26 |
| screener-scanner | 20 | 1.4% | 2.2 | 6.3 | 0.5% | 43 | 23 |
| other | 10 | 0.7% | 3.3 | 5.6 | 0.4% | 43 | 0 |
| visual-decoration | 6 | 0.4% | 2.2 | **21.8** | 0.2% | 0 | 4 |
| breadth | 1 | 0.1% | 0.0 | 6.0 | 0.0% | 0 | 0 |

**Three categories (market-structure, order-flow, support-resistance) are 41% of scripts but 69% of all
drawing-object demand and 74% of the hidden method-syntax sites.** The classic oscillator/MA world
(momentum + trend = 30% of scripts) is almost pure `plot` (1.6–1.9 constructors/script vs 7.6–9.0 plots).

How `found_by` was resolved into one primary label, and the taxonomy's own error rate, are recorded in
`lane1-categories.json → _meta`. Summary: `found_by` is a *discovery* signal (1,001 scripts have 1 term,
424 have 2–5, 18 have none) and **10 of its 134 terms are author handles** (BigBeluga, LazyBear, ChartPrime,
AlgoAlpha, LuxAlgo, Zeiierman, BackQuant, QuantNomad, loxx, TradingView) covering ~330 script-terms with
zero topical content — those are weighted 0 and decided on title alone. Title hits score 3, topical
`found_by` hits 2, multi-word patterns double (so "range filter"→trend beats "range"→support-resistance),
ties broken by a fixed specificity order. **Hand-audit of a random 40: 1 clear error (2.5%), ~12% with a
second equally defensible label.** Two structural caveats: classical chart-pattern detectors (double top,
head & shoulders, cup & handle, quasimodo, zigzag) were folded into *market-structure/smart-money* because
the allowed taxonomy has no chart-pattern bucket — that is the biggest single judgement call and it inflates
the largest category; and **`breadth` = 1 and `visual-decoration` = 6 are artefacts of the search terms,
not of the ecosystem** — those categories are *unmeasured*, not small.

---

## 5. The one correction I would insist on before anyone builds a roadmap

> **Re-run the inventory with a receiver-typed method-call detector, then re-sort the table — because the
> `% of scripts` column, which is the ranking, is wrong for every setter/getter/delete row, not merely
> imprecise.**

Concretely: `line.set_x2` is not a 7.9% primitive, it is a **13.7%** primitive; `box.set_right` is not 5.9%
but **10.6%**; `box.get_top` not 4.0% but **7.8%**; `table.cell` not 13.9% but **17.0%**. There are 1,196
missing (script, primitive) pairs. Any roadmap that draws a "build it now" line at a share threshold — the
obvious way to use this table — will cut the wrong primitives, and it will cut them **in the direction of
dropping exactly the mutate-existing-object API that modern v5/v6 code is built on**. The fix is cheap:
add `(?<![\w.])(\w+)\.(set_\w+|get_\w+|delete|copy|cell|clear|merge_cells)\s*\(` with (a) receiver typing
from `type`/field/`array<T>`/`= T.new(` declarations, (b) exclusion of UDT constructors, user `method`
names and import aliases, and (c) refusal to attribute `.new`/`.copy`/`.clear` on untyped receivers.

Two runners-up, both cheap and both changing conclusions:
* **Add a runtime-multiplicity column** (in-loop flag + the script's own `max_*_count`) so nobody reads
  8,195 constructors as 8,195 objects when the corpus reserves ~570k.
* **Finish the corpus first** — the table describes 1,443 of the 2,155 sources already fetched.
