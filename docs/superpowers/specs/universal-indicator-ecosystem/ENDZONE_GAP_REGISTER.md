# CUSTOM INDICATOR ENDZONE GAP REGISTER

**Purpose.** The durable register of what stands between today's product and the governing
objective: *a sophisticated custom Pine indicator that currently keeps a user on TradingView
should be importable into UCT with its calculations, visuals, inputs, state, persistence and
useful screener outputs intact — and the same class of indicator should be creatable directly
inside UCT.*

**This is not a histogram of unsupported Pine functions.** Gaps are clustered into product
capabilities. A gap is only listed once, in the layer where the fix belongs.

**Status of this document.** Part A (architecture-derived gaps) is complete and every claim is
code-verified with a `path:line` citation. Part B now carries the OOS-2 measured demand
(freeze `5df718c2`, n=60). Part D adds the four defects the baseline itself surfaced.

---

## PART A — HOW THE PIPELINE IS SHAPED (the finding that reorders everything)

Three facts, each verified by direct code reading, together explain most of the distance to the
objective — and they are **not** the facts a "which Pine functions are unsupported?" analysis
would surface.

### A1. Presentation is discarded at the door, not at the renderer

> ⚰️⚰️ **SUPERSEDED BY WAVES B / C0 / C1 — READ THIS BEFORE THE PARAGRAPHS BELOW.**
> Every specific claim in this section was TRUE when written and most are now false.
> `overlay`, `color`, `linewidth`, `style` and `transp` are read
> (`outputPresentation`); `hline` levels are carried; the hand-back is
> `{source, inputs, paramManifest, presentation, outputs}` and every carried output
> brings its own inputs; a **conditional** colour is carried as
> `colorMode: 'column:<key>'` and DRAWN per point; `fill(plotA, plotB)` is carried
> and drawn by a series primitive. What remains true, and is the reason this
> section is kept rather than deleted, is its CONCLUSION: *"a large share of visual
> fidelity needs no renderer work at all — it needs the importer to carry what the
> source already says into fields that already draw."* That is exactly what the
> three waves did, and the measured remainder is in **Part E**.
> ⛔ `displace` is still carried by nobody. That one stands.


`app/src/components/chart/engine/ast/pine.js` is 8,457 lines and the string `overlay` appears in
it **zero times** (verified by direct count). The only presentation argument the translator reads
at all is `display`, at `pine.js:8343` (`args.find((a) => a.name === 'display')`), and it is read
only to mark an output **hidden**.

So `overlay=`, `color=`, `linewidth=`, `style=`, `transp=`, and every styling argument in every
real Pine indicator are parsed past and thrown away. `plot(offset=-N)` is the one that proves the
shape of the problem: the translator *does* compute it (`row.displace`, `pine.js:8050`) and then
nothing downstream carries it — `displace` is not a `defSchema` plot field and `PineBox.jsx` never
forwards it.

The handback is source text and nothing else — `PineBox.jsx:591` sends `{source, inputs,
paramManifest}`; `BuilderSheet.jsx:1899-1923` states it outright: *"THE SOURCE AND NOTHING ELSE —
not the tree the translator built, not a prebuilt document."* The receiving plot row is then born
`style:'line'`, default colour, default width (`BuilderSheet.jsx:256-268`).

**Why this reorders the roadmap.** UCT's visual schema is real, versioned and validated
(`engine/defSchema.js`, `SCHEMA_VERSION = 1` at `:127`) and already expresses 8 plot styles,
per-plot colour, width, line style, opacity, precision, legend, levels and placement. **A large
share of visual fidelity needs no renderer work at all** — it needs the importer to carry what
the source already says into fields that already draw. Any plan that begins with "build a fill
renderer" has mis-ordered the work.

### A2. The translator produces N outputs; exactly ONE survives the door

`translatePine` returns `outputs[]` — one row per `plot`/`plotshape`/`plotchar`/`plotarrow`/
`alertcondition`, and **four** rows for each `plotcandle`/`plotbar` (`MULTI_OUTPUT_CALLS`,
`pine.js:383-386`, expanded at `:7718-7723`). Every row carries its own `formula`, `ast`, `title`,
`hidden`/`hiddenReason` and `refusal`.

Then `PineBox.use()` (`PineBox.jsx:565-591`) hands back `active.formula` — **the single row the
member clicked**. A four-plot indicator is four separate Apply actions into four separate builder
rows, each one losing the relationship to its siblings. `BuilderSheet`'s own multi-plot document
(`compute.trees`/`treesHash`/`scanPlot`/`sources`, `BuilderSheet.jsx:489-498`) exists and works —
the Pine path simply never reaches it.

The narrowing is structural underneath, too: `closedTable.json` has **no multi-output node**, so
one AST call yields exactly one series. Multi-plot lives only at document-composition level.

### A3. "Assisted import" is one offer, not a rewrite engine

There is exactly **one** machine-appliable offer in the entire engine: `Resolver.mintickGuardOffer`
(`pine.js:5040-5061`), which rewrites `math.max(<expr>, syminfo.mintick)` → `(<expr>)`. It is the
only refusal that carries both `suggest` **and** `span`, and `pine.blindCorpusDecomposition.test.js:43-47`
asserts that as an invariant: *"every other guard is NO_OFFER by construction, not by defect."*

Three further refusals carry `suggest` with **no** `span` — fractional-window → `hma`
(`pine.js:6240`), `session.regular` and `timeframe.period` (`pine.js:5521`, `:5549`). Those are
copy-by-hand advice; the UI's apply button renders only when `refusal.span` exists
(`PineBox.jsx:319-328`).

**Consequence:** the gap between RAW and ASSISTED acceptance is bounded by one rewrite. Reporting
"assisted acceptance" as though a general remediation layer exists would overstate the product.

---

## PART B — THE GAP REGISTER

Severity key. **S1** = silent-wrong-result risk. **S2** = blocks the marketable user promise.
**S3** = materially degrades fidelity. **S4** = polish.

Layers: `IMPORT` (translator → document boundary) · `SCHEMA` (definition vocabulary) ·
`RENDER` (binder/LWC) · `EXEC` (kernel semantics) · `SCREEN` (scan projection) ·
`PERSIST` (storage) · `BUILDER` (authoring UI) · `UX` (disclosure) · `HARNESS` (validation).

---

### CLUSTER 1 — VISUAL: PRESENTATION NEVER LEAVES THE SOURCE

The highest-leverage cluster in the register. Every gap here is at the **IMPORT** layer, and the
renderer already draws the target.

| ID | Gap | Layer | Sev | Renderer ready? | Evidence |
|---|---|---|---|---|---|
| **V-01** | `overlay=true/false` is never read; the member picks pane placement by hand | IMPORT | S2 | **Yes** — `placement.js:290-408`, targets at `defSchema.js:208` | `overlay` count in `pine.js` = 0 |
| **V-02** | `color=` literal never carried; every imported plot is born default-coloured | IMPORT | S3 | **Yes** — `defSchema.js:1276-1289`, `pool.js:433-440` | `BuilderSheet.jsx:256-268` |
| **V-03** | `linewidth=` never carried | IMPORT | S4 | **Yes** — `defSchema.js:1291-1304`, `pool.js:546` | as above |
| **V-04** | Pine plot `style=` (line/stepline/histogram/area/circles) never carried | IMPORT | S3 | **Yes** — 5 of Pine's styles map 1:1 onto `PLOT_STYLES` (`defSchema.js:151`) | as above |
| **V-05** | `plot(title=)` never becomes the plot label | IMPORT | S4 | **Yes** — `plots[].label`, `legend.label` | `BuilderSheet.jsx:452` |
| **V-06** | `transp=` / colour alpha never carried | IMPORT | S4 | **Yes** — `plots[].opacity` (`defSchema.js:1483-1492`) | no author UI either |
| **V-07** | `hline()` is a chart-only ignored note, though the schema has a first-class `hlines` plot with `levels` | IMPORT | S3 | **Yes** — `defSchema.js:151`, drawn as price lines `binder.js:144-156, 779` | `pine.js:1366-1369` `CHART_ONLY_CALLS` |
| **V-08** | `plot(offset=-N)` computed as `row.displace` then dropped — no schema field carries it | IMPORT + SCHEMA | S3 | Needs one plot field | `pine.js:8050`; `displace` absent from `defSchema` |

**Shared fix.** One capability, not eight patches: a **presentation-extraction pass** in the
translator that emits a per-output visual spec alongside `formula`/`ast`, plus a handback that
carries it (`PineBox` → `BuilderSheet.buildDefinition`). V-01…V-07 are then field mappings.
**Test strategy:** a fixture per argument asserting the saved document's `plots[i]` field, plus a
pixel-parity run through the existing `tools/chart_parity.py`.

---

### CLUSTER 2 — VISUAL: DECLARED IN THE SCHEMA, DRAWN BY NOTHING

Three fields the schema validates, carries and cross-checks — and no renderer reads. These are
**deliberate, pinned** states, not bugs; they become gaps the moment we claim visual fidelity.

| ID | Gap | Layer | Sev | Evidence |
|---|---|---|---|---|
| **V-10** | `plots[].fill{with}` — validated + cross-checked, **drawn by nothing**. A document carrying it installs cleanly and renders no fill. | RENDER | S2 | `defSchema.js:1667-1679`, `:1690-1717`; a source-probe rail (`defSchema.test.js:1188-1235`) asserts the reader list is empty |
| **V-11** | `plots[].edges` (band) validated (`defSchema.js:1577-1664`) but read by no renderer; `style:'band'` maps to a plain `LineSeries` (`pool.js:65-73, 96-99`). Bollinger "looks right" only because its edges are separate line plots. | RENDER | S3 | as cited |
| **V-12** | `colorMode:'column:<key>'` — the general per-bar parametric colour — validated and inert; only `colorMode:'sign'` renders. | RENDER | S3 | `defSchema.js:298-322`, `pool.js:579-592` |

**Why this cluster is upgraded by real demand.** `fill()` appears in 6/30 real public scripts and
dynamic colour in 17/30 — dynamic colour is the **most-demanded visual capability after `plot()`
itself**, and today only its sign-of-zero special case renders.

---

### CLUSTER 3 — VISUAL: ABSENT FROM THE MODEL ENTIRELY

| ID | Gap | Layer | Sev | Real demand (30-script public corpus) | Evidence |
|---|---|---|---|---|---|
| **V-20** | `bgcolor()` — background tinting | SCHEMA+RENDER | S3 | 9/30 (with `barcolor`) | reserved style `'bgband'` refused, `defSchema.js:162`; `pine.js:1366-1369` |
| **V-21** | `barcolor()` — recolouring price bars | SCHEMA+RENDER | S3 | as above | `'barcolor'` reserved, `defSchema.js:162` |
| **V-22** | `plotshape`/`plotchar`/`plotarrow` — value survives, **glyph, anchoring and direction do not**. A `plotshape` renders as a 0/1 line. | SCHEMA+RENDER | S2 | 9/30 | `pine.js:326-340` states the limit; `pine.js:350-362` ("Nothing here reads it as a direction") |
| **V-23** | `plotcandle`/`plotbar` — four numeric columns, no candle. The engine's constructor map has no candlestick/bar series. | SCHEMA+RENDER | S3 | 1/30 | `binder.js:61-66` `SERIES_CTOR` = line/histogram/area/baseline only |
| **V-24** | `label.new` / `line.new` / `box.new` / `table.new` / `polyline` / `linefill` — persistent graphical objects created, mutated and deleted across bars | SCHEMA+RENDER+EXEC | S2 | 7/30 | `NAMESPACE_GUARD` → `pine:drawing`, `pine.js:450-458` |
| **V-25** | Placement is **document-level, not per-plot** — one document cannot mix an overlay plot and a pane plot | SCHEMA+RENDER | S3 | common in multi-pane indicators | `compatHarness.level3Fixture.test.js:8-18` |
| **V-26** | One price scale per pane — two indicators sharing a pane cannot have independent axes | RENDER | S4 | — | `placement.js:283-289` |
| **V-27** | `cross` marker style reserved and refused (LWC 5.2 draws circle/square/arrow only) | RENDER | S4 | — | `defSchema.js:156-162` |

**The leverage note that belongs here.** The team has already written **six** ISeriesPrimitive /
IPanePrimitive implementations for non-indicator features — `levelZonesPrimitive` (boxes),
`swingLabelsPrimitive` (bar-anchored text), `sessionShadingPrimitive` (background),
`earningsBadgePrimitive`, `prevDayLevelsPrimitive`, `watermarkPrimitive`
(`StockChart.jsx:8374, 8421, 10108, 10135, 10159, 10179`). **The machinery V-20, V-24 and V-10
need already exists in this codebase** — it is simply not reachable from a definition. That is an
architecture opportunity, not a from-scratch build.

---

### CLUSTER 4 — MULTI-OUTPUT: THE INDICATOR IS SACRIFICED AT THE DOOR

| ID | Gap | Layer | Sev | Evidence |
|---|---|---|---|---|
| **M-01** | The Pine handback is single-output: a multi-plot indicator must be Applied once per plot into unrelated builder rows | IMPORT | S2 | `PineBox.jsx:565-591`; `BuilderSheet.jsx:1964` |
| **M-02** | `closedTable.json` has no multi-output node — one AST call yields exactly one series | SCHEMA | S3 | readiness report `:44-48` |
| **M-03** | A Pine import saved **as a screen condition** loses its parameter manifest entirely | IMPORT | S2 | `PineBox.jsx:575-590` (`paramManifest = wrapped ? null : activeParamManifest`) |

**Note.** `BuilderSheet.buildDefinition` already emits multi-tree documents
(`trees`/`treesHash`/`scanPlot`/`sources`, `:489-498`). M-01 is a wiring gap, not a modelling one.

---

### CLUSTER 5 — SCREENER PROJECTION

| ID | Gap | Layer | Sev | Evidence |
|---|---|---|---|---|
| **S-01** | The screener is **boolean-only**. A numeric indicator series cannot be screened as a value; the member must author the comparison into the tree at import time. | SCREEN | S2 | `scan_definition.py:477-483` (`yields` refusal); applied as `float(value) != 0.0` at `scan_evaluator.py:1676` |
| **S-02** | One tree per definition reaches the screener (`compute.scanPlot`); the **alert** lane can already address every plot by name (`u_<id>.<plotKey>`) | SCREEN | S3 | `scan_definition.py:334-368` vs `alert_user_series.py:329`, `ast_interpret.py:3671` |
| **S-03** | `scan_hits.value` can only ever be `1.0` — the gate forces a boolean tree and `_cmp`/`_logical` return `0.0/1.0/NaN` — while the UI ships a significant-digit formatter and a "sort by value" control described for RSI-scale numbers | SCREEN | **S1** | `scan_evaluator.py:1657, 1676-1682`; `ast_interpret.py:1985-1991`; `ScanResults.jsx:194-238`; `ScanResults.value.test.jsx:38` asserts `71.5`, a value the gate cannot produce |
| **S-04** | `scan_evaluator` never passes `inputs` to `ast_interpret.interpret`, so a definition naming a member input resolves `resolve:name` and can never be a screen | SCREEN | S2 | `scan_evaluator.py:1655-1657` vs `ast_interpret.py:2980-2984`; the alert lane does thread inputs (`alert_user_series.py:267`) |
| **S-05** | Custom-indicator values never become screener **columns** — `screener_rows` has a fixed vocabulary and no `def_hash` column | SCREEN | S3 | `snapshot_db.py` |

**S-03 is the register's clearest silent-wrong-result candidate outside the translator** and is
listed S1 on that basis. It requires adjudication before it is stated as a defect in the OOS
report: the failing direction is a UI that presents a column as meaningful when it is constant.

---

### CLUSTER 6 — PERSISTENCE AND EDITABILITY

| ID | Gap | Layer | Sev | Evidence |
|---|---|---|---|---|
| **P-01** | **The original Pine source is not persisted.** Nothing about a saved document remembers it was Pine. | PERSIST | S2 | `BuilderSheet.jsx:1798-1808`; dialect survives as telemetry only (`user_definitions.py:61-69`) |
| **P-02** | Consequence of P-01: an improved translator **cannot re-translate** existing imports; the member must find and re-paste the original script | PERSIST | S2 | derived from P-01 |
| **P-03** | Consequence of P-01: a member cannot diff what they saved against the script they pasted | UX | S3 | derived from P-01 |
| **P-04** | A document can be stored whose `sources[k]` disagrees with `trees[k]` — Python has no parser, so the API accepts what the browser would refuse | PERSIST | S2 | `user_definitions.py:439-455`; the named fix (`compute.sourceHashes[k]`) is documented as not done |
| **P-05** | No duplicate/clone action for a saved definition within one account (only edit, soft-delete, share-link, cross-account install) | PERSIST | S3 | `api/routers/user_definitions.py` |
| **P-06** | Reopen **refuses to open** a definition stored without its source text rather than reconstructing from the AST | PERSIST | S4 (correct behaviour, noted for completeness) | `BuilderSheet.jsx:1112-1116, 1183-1188` |

**P-01 is the single highest-leverage persistence gap** and it is cheap: storing the source text
alongside the document costs one column and unlocks P-02 and P-03 outright.

---

### CLUSTER 7 — BUILDER / DIRECT CREATION

The end-state requires the same class of indicator to be **creatable inside UCT**. Track three
things separately: *engine can represent it* / *Pine import can produce it* / *builder can create it*.

| ID | Gap | Layer | Sev | Engine | Import | Builder | Evidence |
|---|---|---|---|---|---|---|---|
| **B-01** | `style:'band'` + `edges` | BUILDER | S3 | ✅ schema-legal | ❌ | ❌ no cross-plot control | `BuilderSheet.jsx:230-234` |
| **B-02** | `colorMode:'sign'` + `colorUp`/`colorDown` | BUILDER | S3 | ✅ renders | ❌ | ❌ no UI at all | `compatHarness.level3Fixture.test.js:19-27` |
| **B-03** | `plots[].opacity` | BUILDER | S4 | ✅ | ❌ | ❌ | `defSchema.js:1483-1492` |
| **B-04** | Plot styles offered | BUILDER | S4 | 8 | — | 6 | `BuilderSheet.jsx:235-242` |
| **B-05** | `hlines` plots | BUILDER | S4 | any number | ❌ | exactly one | `BuilderSheet.jsx:2328-2333` |
| **B-06** | Placement targets | BUILDER | S4 | price/pane/volume | ❌ | price/pane | `BuilderSheet.jsx:2320-2327` |
| **B-07** | Per-plot `precision`, `role`, `legend.label` | BUILDER | S4 | ✅ | ❌ | fixed defaults | `BuilderSheet.jsx:452, 457` |

**Pattern.** Every row reads *engine ✅ / import ❌ / builder ❌*. The engine is consistently ahead
of both doors. **A capability present only internally is not a finished user-facing feature** —
this table is the evidence for that claim, and it is the argument for treating "carry
presentation" (Cluster 1) and "expose presentation" (Cluster 7) as one program.

---

### CLUSTER 8 — ASSISTED IMPORT

| ID | Gap | Layer | Sev | Evidence |
|---|---|---|---|---|
| **A-01** | Exactly one machine-appliable offer exists (`mintickGuardOffer`); every other refusal is NO_OFFER **by construction** | IMPORT | S3 | `pine.js:5040-5061`; invariant asserted at `pine.blindCorpusDecomposition.test.js:43-47` |
| **A-02** | Three refusals carry advice with no `span` (fractional-window→`hma`, `session.regular`, `timeframe.period`) — the member must retype | UX | S4 | `pine.js:6240, 5521, 5549`; apply button gated on `span` at `PineBox.jsx:319-328` |
| **A-03** | No registry of safe rewrites; offers are ad-hoc at their guard sites | IMPORT | S4 | no such module found |

---

### CLUSTER 9 — IMPORT UX / FIDELITY DISCLOSURE

| ID | Gap | Layer | Sev | Evidence |
|---|---|---|---|---|
| **U-01** | Dropped visuals **are** disclosed (`pine:chart-only` notes surface as "ignored" lines, `PineBox.jsx:957-969`) — but `pine:declaration` fires on essentially every script, so **18/18 accepted community scripts carry a note**. A universal signal carries no information: the member cannot tell "we ignored your declaration line" from "we dropped your fill". | UX | S2 | measured this session on the 30-script corpus |
| **U-02** | No FULL/PARTIAL fidelity verdict is presented — the member is not told whether what imported is the whole indicator | UX | S2 | no such field in the handback |
| **U-03** | The member is not told which outputs are screenable vs chart-only before saving | UX | S3 | `toCondition.js` measures it (49 of 148 columns scannable) but the number is not surfaced per import |
| **U-04** | Nothing distinguishes "this is your indicator" from "this is one plot of your indicator" at Apply time | UX | S2 | consequence of M-01 |

**U-01 is the honesty gap that matters most.** The disclosure machinery exists and works; it is
drowned by a note that fires unconditionally. Fixing it is cheap and directly serves the
non-negotiable *do not produce false success through a friendly UI*.

---

### CLUSTER 10 — HARNESS / VALIDATION

| ID | Gap | Layer | Sev | Evidence |
|---|---|---|---|---|
| **H-01** | **The 48-script corpus that has driven development is 100% V1 on the predeclared visual scale** — every one has exactly one `plot()` and *zero* hlines, fills, bgcolor/barcolor, shapes, candles, objects, dynamic colour or conditional visibility. The real 30-script public corpus is 28/30 **V3 or above**. | HARNESS | **S2** | measured this session: `python tools/oos_visual_classify.py tests/fixtures/pine_blind` |
| **H-02** | No harness exercises the real chart for an imported definition; `TRANSLATES` has been the measured quantity throughout | HARNESS | S2 | `tools/chart_parity.py` exists and is unused for user documents |
| **H-03** | `tools/compat_harness.py` (proposed Layer A driver in the 2026-09-05 readiness report) was never built | HARNESS | S4 | absent from `tools/` |

**H-01 is a finding about the program, not the product, and it is the reason OOS-1 exists.** The
headline numbers this program has reported for two years (RAW 27/48, ASSISTED 36/48) are measured
entirely on scripts that have **no visual surface at all**. They are honest numbers about screen
translation and say nothing about indicator fidelity. Any marketability claim resting on them
would be a category error.

---

## PART C — WHAT THE EVIDENCE SAYS ABOUT ORDERING

Derived from the register, not from a preferred plan:

1. **Cluster 1 (carry presentation) is first by a wide margin.** Eight gaps, one shared fix, and
   the renderer is already capable of every target. It is the only cluster where fidelity improves
   without new rendering code.
2. **Cluster 9 (disclosure) is first-equal on the correctness axis** and is small. It is what keeps
   a partial import from reading as a complete one while the rest of the work lands.
3. **Cluster 4 M-01 (multi-output handback)** unlocks the difference between "one plot of your
   indicator" and "your indicator". The document model already supports it.
4. **Cluster 6 P-01 (persist the source)** is one column and removes the permanent penalty of
   importing under a translator that will improve.
5. **Cluster 2 (inert fields) then Cluster 3 (absent primitives)** — real renderer work, ordered
   by measured demand: dynamic colour → fill → bgcolor/barcolor → shapes → objects.
6. **Cluster 5 S-03/S-04** are correctness items in the screener and should be adjudicated before
   any screener claim is made.

---

---

## PART D — GAPS THE OOS-2 BASELINE ITSELF SURFACED (2026-09-07)

None of these was visible from architecture reading. Each was found by running a blind corpus
and then verifying the mechanism directly.

| ID | Gap | Layer | Sev | Evidence |
|---|---|---|---|---|
| **C-01** | **`readsBars` asserts bar-reading for ANY `call` node without inspecting its arguments**, so a constant-valued call (`max(8, 42)`) is never hidden, counts as usable, and can make a whole script `ok:true`. | EXEC | **S1** | `pine.js:8175`; probe: `readsBars(max(8,42)) === true`, `readsBars(20-(7-5)*4) === false` |
| **C-02** | **Acceptance can rest on a contentless output.** 3/60 scripts accepted after every meaningful series was correctly refused — 1 on two constants, 2 on bare `open/high/low/close` from `plotcandle`. In one, the *selected* output is `open`. | IMPORT | **S1** | OOS-2 §4; 3 independent adjudicators, 18 FAITHFUL / 3 MISLEADING |
| **C-03** | **A refusal that names the wrong cause.** `f(...).field` (Pine v6 method/UDT access) trips the lexer's character guard and reports *"Pine has no character like this one"* on valid source. | IMPORT + UX | S2 | 4/60; probe-isolated |
| **C-04** | **A silent decline.** `ok:false` with `refusal:null` — no message at all — when a script's only `plot()` is the `plot(0)` placeholder table indicators conventionally carry. | UX | S2 | 1/60, `long_tail__17` |

**C-02 is causally downstream of V-02.** `plotcandle`'s entire payload is its `color=` argument;
because presentation is discarded at the door, the call degenerates into four raw price columns
that read bars honestly and carry nothing. Fixing V-02 removes half of C-02 at the root.

### Measured demand behind Part A's clusters (n=60, source-only)

| Cluster | Primitive | scripts | call sites |
|---|---|---:|---:|
| 3 | `label`/`line`/`box`/`table` objects (V-24) | **43/60** | **1204** |
| 2 | dynamic colour (V-12) | **40/60** | — |
| 1 | `plot()` styling carried by nobody (V-02…V-05) | 33/60 | 195 |
| 3 | `plotshape`/`char`/`arrow` (V-22) | 19/60 | 69 |
| 2 | `fill()` — schema-inert (V-10) | 17/60 | 35 |
| 3 | `bgcolor`/`barcolor` (V-20/21) | 17/60 | 24 |
| 1 | `hline()` dropped at import (V-07) | 10/60 | 19 |
| 3 | `plotcandle`/`plotbar` (V-23) | 5/60 | 6 |

Multi-timeframe (`security` or `request.security`) is demanded by **12/60**.

---

## AMENDMENTS

Append only; each dated, each stating what changed and why.

**2026-09-07 — Part B populated from OOS-2; Part D added.** Four new gaps (C-01…C-04) recorded
from the baseline run. H-01's prediction was confirmed: the development corpus is 100% V1 and the
blind corpus is 72% V5, and acceptance falls from 75% (V3) to 23% (V5).


---

## PART E — WHAT C0R AND C1 MEASURED, AND WHAT IS LEFT (2026-09-07)

Every row here is a MEASURED count over the frozen 60 (`5df718c2`) or the 18
accepted scripts, not an estimate. Clustered by the product capability that would
close it, per this register's own rule.

### E1 — CLOSED by C0R / C1

| Capability | Evidence |
|---|---|
| A definition may not reach Save naming a free symbol | 8/8 previously SAVE_BLOCKED scripts are past it; `builderInputs.symbolClosure.test.js` |
| Sibling outputs carry the inputs their formulas name | 6 of those 8; `pineBoxSiblingInputs` + `BuilderSheet.siblingInputUnion` |
| A bool input as a visibility gate keeps its semantics | `pineBoolVisibility.test.js`, evaluated at both toggle states |
| Static colour behind a NAME | 20 output rows moved from "uncarried expression" to the author's actual colour |
| v3/v4 bare colour constants (`red`, `lime`, `aqua`) | were read by nothing; now the same 18 hexes as `color.x` |
| `color.rgb(r,g,b)` and `input.color(default)` | carried as static colours |
| **Conditional colour, drawn per point** | `colorMode: 'column:<key>'`, 4 rules across 2 saved definitions |
| **Bands between two plots** | series primitive; 6 bands across 4 saved definitions; A/B pixel proof |

### E2 — OPEN, with the number that sizes each one

| # | Gap | Measured demand | Where the fix belongs |
|---|---|---|---|
| E2.1 | **Document size cap, 65,536 bytes** | 2 of 18 | ⭐ **ANSWERED BY C2B, AND IT IS NOT THE CAP.** One enforcement point (`user_definitions.py:916`); nothing else on the path limits size. The two blocked documents gzip to **4,838 B and 4,018 B** — ×68.6 and ×45.1 — so they hold under 5 KB of information and are ~98.5% repetition (`compute.trees` is 81-84% of each, with near-identical 35 KB trees). The fix is a SHARED-SUBTREE representation, which breaks Track F `astPath` locators, parameter-edit locality, and `astHash`/`def_hash`. **Returned as an architecture decision; no constant changed.** See `C2_CAPACITY_AND_CONTAINMENT.md`. |
| E2.2 | **Compute budget at chart scale** (`interpret:steps`) | 2 of 18 | ⭐ **RESOLVED IN PART BY C2A.** The all-empty symptom was CONTAINMENT — `astColumnsFor` had no `try`, so one refusing tree took every sibling with it. Fixed: master-line-lite now draws 3 of 7. The remaining refusal is real and the budget MUST NOT be raised: a recurrence step costs ~374 ns, so the 1e6 ceiling is already ~374 ms of blocked main thread per column and the 5,000-bar case would be ~468 ms × 4 columns. `PINE_STATE_WARMUP` 250 × 5,000 bars = 1.25M gives a **4,000-bar break-even**, so every translated Pine `var` refuses on the default window. A smaller daily window would unlock the class at ~1.5 s per document — an owner trade-off, returned not taken. |
| E2.2b | **Shared-subtree duplication** | 77-84% of counted nodes in the complex documents; ×130 source→document for `supertrend` | the canonical AST representation. It is ONE fact with TWO symptoms — compute repetition and document bloat — and it is now the largest single lever in the register. |
| E2.3 | **N-way colour rules** | 8 output rows (5 want 3 colours, 3 want 4) | a plot carries `colorUp`/`colorDown` — two. A palette field is new schema. |
| E2.4 | **`cond ? colour : na` — per-point visibility** | 16 output rows | there is no per-point hide for a line. Carrying only the inner colour would draw a line exactly where the author hid one. |
| E2.5 | **`plotcandle` colour payload** | 12 output rows | the object model; explicitly out of scope for C0/C1 |
| E2.6 | **`var color X = …` not followed** | a handful | a `var` binding may be reassigned; following it blindly would yield a wrong colour |
| E2.7 | `ta.alma`, `ta.pivothigh` right-bars, non-re-seeding `var` accumulators | 3 import refusals across the parity set + OOS | the grammar / the bounded accumulator |
| E2.8 | `displace` (negative `plot(offset=)`) | unchanged from A1 | carried by nobody, still |

⛔ **E2.3 AND E2.4 ARE WHY "DYNAMIC COLOUR IS SUPPORTED" MUST NOT BE SAID FLATLY.**
Two-way conditionals are supported and drawn. Three- and four-way rules, and colour
used as a visibility gate, are not — and together they are 24 output rows against the
2-way class's handful. The scorecard states it that way.

---

## PART F — WHAT C2C MEASURED (2026-09-07)

### F1 — E2.1 and E2.2b, ANSWERED TOGETHER

They were always one fact with two symptoms, and the shared canonical graph
(`engine/ast/graph.js` · `api/services/compute_graph.py`) is the lever.

| | before | after | with the cap UNCHANGED |
|---|---|---|---|
| `…03-supertrend-kivancozbilgic` | 331,977 B (×5.1 the cap) | **6,882 B** | **11% of the cap — FITS** |
| `…22-rsi-levels-regime-map` | 181,315 B (×2.8 the cap) | **10,485 B** | **16% of the cap — FITS** |
| the frozen 60, over cap | **2 of 21 buildable** | **0 of 21** | — |

- supertrend: **8,119 inlined nodes across 10 trees → 76 distinct. 99.1% was
  repetition.** rsi-levels: 4,719 → 146, **96.9%**.
- `treesHash` and `compute.fn` are **asserted unchanged** in both lanes: the
  documents are the same indicators, not smaller ones, and adopting the
  representation migrates nobody's alerts.
- **No gzip anywhere.** Every number is raw canonical JSON — the bytes
  `MAX_DEFINITION_BYTES` counts. `MAX_DEFINITION_BYTES` was not touched.
- **E2.1 status: CLOSED for the corpus.** **E2.2b: CLOSED for STORAGE, and
  measured-but-small for COMPUTE** — see F2.

### F2 — the half of E2.2b that did NOT pay, reported as measured

The same 77–84% repetition was expected to buy compute. It does not, on the
documents that are expensive:

```
=== C2C.19 COMPUTE COST, 400 bars, cross-column memo on ===
   4957ms ->  4559ms  ( 8% saved)  …03-supertrend-kivancozbilgic
     19ms ->     7ms  (63% saved)  …22-rsi-levels-regime-map
    276ms ->   255ms  ( 8% saved)  …14-master-line-lite
      2ms ->     2ms  ( 0% saved)  …12-cm-ultimate-rsi-mtf
```

⛔ **The repetition C2A measured is of counted NODES; the cost is in
RECURRENCE, and a subtree that reads a recurrence bind can never be memoised**
(caching it freezes the recurrence at step one — a silent wrong number). This is
the third time this hypothesis has been tested and the third time it has come
back small (C2A's hoisting probe: ~7%). **E2.2 is unchanged by C2C**, and the
budget still must not be raised.

### F3 — new, opened by this wave

| # | Item | Note |
|---|---|---|
| F3.1 | A shared graph can describe a tree far larger than itself | Guarded: `expandedSizes` bounds the inlining in integers before anything is built (2048/plot, 32768/document). A cycle is *unrepresentable* — references run strictly backwards by construction. |
| F3.2 | V2 is emitted only when V1 would not fit | A deliberate conditional, safe because the two forms have provably identical identities, so the threshold can only decide whether a save is REFUSED. Making V2 the default for every multi-tree document needs a corpus-wide re-baseline and is **not** smuggled into this wave. |
| F3.4 | **The WIRE payload for a graph document is its MATERIALISED size** | `_row_to_dict` expands on read so every server-side reader keeps working, and the API therefore answers `GET /api/user-definitions` with the 362 KB forest for a 8 KB stored document. The bytes at REST are what the cap governs and what this wave was authorised to fix, so this is not a regression against the baseline (the document could not be stored at all before) — but it is a real cost, measured, and the fix is cheap: the client already reconstructs the whole document from the graph (`hydrateGraphDocument`), so the route could send the graph alone once every read surface hydrates. **Named, not fixed** — see F3.3 for the surfaces that would have to be wired first. |
| F3.3 | Share-preview / version-history surfaces do not hydrate | A graph document read through `previewSharedDefinition` / `fetchDefinitionHistory` gets `trees` (the server materialises) but not the re-derived `compute.source`. Named rather than fixed; the list door and the save door are both wired. |


---

## PART G — WHAT C2D AND C3A MEASURED (2026-09-07)

### G1 — C2C's two operational findings, CLOSED

| # | item | status |
|---|---|---|
| F3.4 | the wire payload was the MATERIALISED size | ⭐ **CLOSED.** `?graph=1` opt-in compaction on list / get / history. `298,163 B → 7,382 B` (×40.4) and `167,738 B → 10,983 B` (×15.3) through the real routes; a forest document is untouched byte for byte. Read cost 8.32 ms → 0.16 ms serialise, 10.81 ms → 0.13 ms parse. |
| — | Track F parameter placement | ⭐ **CLOSED, and it was worse than reported.** Root cause: two translations. `PineBox` built the manifest from its own `paramManifest: true` pass; the sheet saved `memberInputTranslation`'s trees. Measured: output-0 astHash DIFFERS on both complex scripts, and `…12-cm-ultimate-rsi` produces 7 outputs in one pass and 6 in the other — so `chosen` indexed two different arrays. **Live proof: 37 declared parameters across 17 saved definitions, 37 attached, 0 detached** (was 2 detached). |
| F3.3 | share-preview / history do not hydrate | 🟡 **HALF-CLOSED.** History is wired (it is where compaction pays most — every version would otherwise arrive as its own forest). Share-preview and install still return the materialised document; correct, just not yet small. |

### G2 — new, opened by C2D

| # | item | note |
|---|---|---|
| G2.1 | **V1 → V2 migration would have detached every control** | Found by writing C2D.4's attack set, not by a failing run. `locators` is immutable-from-prior (what makes a forged locator unusable), so a V1 document re-saved as a graph kept `astPath` locators that mean nothing there. Fixed by RE-EXPRESSING the trusted position structurally (`compute_graph.locator_for_ast_path`), never by trusting the client's new one. **This shipped in C2C and was live for the length of one wave** — it only failed to bite because the corpus documents were fresh creations. |
| G2.2 | a V1 manifest for a shared input is enormous | The CORRECT manifest for `…03-supertrend` is **666 astPath locators** for two controls (~100 KB); the graph form is **2**. Recorded because it is the strongest argument for the graph-native locator, and because the V1 document grew from 336 KB to 438 KB once the manifest became correct. |

### G3 — C3A visual demand (frozen 60, source-text census)

| primitive | scripts | sites | C3A status |
|---|---|---|---|
| `plotshape` | **18/60** | 65 | ⭐ **BUILT** — translator → schema → binder → `createSeriesMarkers` |
| `plotchar` | 2/60 | 5 | ⭐ **BUILT**, same representation |
| `bgcolor` | 12/60 | 19 | ❌ not built — needs a pane-background primitive |
| `barcolor` | 10/60 | 10 | ❌ not built — reaches into the host's own candle series |
| `plotcandle` | 5/60 | 5 | ❌ not built — needs a real secondary candle series |
| `plotbar` | 1/60 | 1 | ❌ not built, same reason |
| `plotarrow` | **0/60** | 0 | ⛔ **deliberately not built — zero demand**, decision recorded as a test |

⛔⛔ **THE ORDERING FACT, STATED RATHER THAN AVERAGED:**

```
scripts wanting ANY C3A primitive:      32/60
scripts wanting ANY object lifecycle:   46/60
scripts wanting BOTH:                   23/60
scripts wanting ONLY C3A primitives:     9/60
```

**C3A moves 32 scripts partway and 9 the whole way. The object model is 46/60
and C3A does not reduce it** — `table.cell` alone is 402 call sites. Summing the
two families would produce one number that justifies building the wrong thing
first, which is why they are counted apart.

### G4 — what C3A did NOT do, named

- **No TradingView capture was taken.** The marker lane is proved against the
  product's own renderer input, not against TradingView's rendering. Claiming
  visual parity without that capture would be the assumed-verify failure this
  program has already paid for once. **C3A.12 is NOT satisfied.**
- The Complex Visual Parity Set was **not** re-run (C3A.11).
- No object lifecycle exists, and no declarative label is offered as a stand-in
  for one.


---

## PART H — C3A-CLOSE EVIDENCE, AND THE C3B CENSUS (2026-09-07)

### H1 — the fixed parity set, remeasured at HEAD

```
  VISUAL_MINIMAL 6 · VISUAL_PARTIAL 2 · VISUAL_BLOCKED 2 · VISUAL_FULL 0
  members whose OBJECT demand is unmet: 9/10
```

⛔ **Zero VISUAL_FULL, and the classifier cannot award it while objects are
missing.** One cause dominates all ten: nine of them construct graphical objects
and carry none.

### H2 — the TradingView vendor check is BLOCKED, not skipped

Requires a logged-in session, which the standing vendor boundary reserves to the
owner. A public script preview IS reachable (verified) and was **deliberately
not used**: it carries unknown bars, so it cannot discriminate an event bar from
an off-by-one, and `tests/fixtures/vendor/README.md` forbids exactly that
unattributable comparison. Capture packet ready:
`C3A_CLOSE_VENDOR_CAPTURE_PACKET.md`, ~15 minutes.

The three discriminations are settled at **spec tier** instead — this repo's own
`spec-falsified` class, explicitly weaker than `confirmed` — each with a fixture
whose wrong answer is a *different array*, plus a control proving the fixture can
fail.

### H3 — shape approximation matrix

`EXACT 4 · CLOSE_APPROXIMATION 5 · MATERIAL_APPROXIMATION 3 · UNSUPPORTED 0`

⛔ `shape.xcross` is `plotshape`'s own default and is a MATERIAL approximation,
so the commonest marker call in the corpus is the one most easily assumed exact.

### H4 — C3B.1 object census, and the finding that moves the premise

| | |
|---|---|
| scripts using ANY object | **46/60** |
| …needing UPDATE (identity across bars) | 35/60 |
| …needing DELETE | 30/60 |
| …using an object ARRAY | **23/60** |
| …CREATE-only | **1/60** |
| …historically indexing an object ref | **0/60** |
| **building objects INSIDE a loop** | **19/46** |
| **reachable by an object model under RISK-043** | **27/46** |

⛔⛔ **C3B was authorised against "46/60". The reachable figure, with
generalized loops correctly still refused, is 27 — 45% of the corpus, not 77%.**
Still the largest single item in this register, and still the class that turns
partial indicators into whole ones, but a materially different trade than the
headline.

Three design facts fall out:

1. **CREATE-only serves 1 script.** Identity across bars is the entry ticket,
   not an enhancement.
2. **Arrays are half of all object scripts (23/46).** C3B.11's "small tail may
   remain partial" does not apply.
3. **32/60 authors declare `max_*_count` themselves**, so C3B.13's resource
   envelope has a natural source rather than an invented one.

### H5 — an instrument that polluted its own measurement

⚰️ The first parity run was taken with the harness's `--keep` flag, which leaves
every imported indicator attached to the chart. Three members came back
`SAVED_NOT_RENDERED`. A clean sandbox restored the first of them to
`FULL_JOURNEY_PASS` — **the failures were my own flag, persisted into the
workspace layout, not the product.** Recorded because a contaminated green is
the same class of defect as a contaminated red, and the run that produced those
three rows would otherwise have been reported as evidence.
