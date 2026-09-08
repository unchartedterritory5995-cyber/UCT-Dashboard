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

### H2 — the TradingView vendor check is DONE, and it found a wrong constant

**Closed 2026-09-07** by an owner-authenticated browser session, not by the owner
doing the capture by hand. The observation is
`tests/fixtures/vendor/visual/marker-semantics-spy-1d-2026-09-07.json`; the rail
is `app/src/components/chart/builder/vendorMarkerParity.test.js` (10 cases,
including a one-bar-shift control).

**This is the first vendor observation of VISUAL semantics the repo holds.** All
22 existing ones are numbers, and a number cannot tell you which bar a glyph
landed on. SPY · 1D · NYSE Arca, 50 daily bars (2026-06-26 → 2026-09-04), read
out of TradingView's own chart model — bars from the main series, MA20 and every
marker column from the study, both on the SAME chart in the SAME session, so a
delta cannot be a data delta.

All four discriminations moved from `spec` to **`confirmed`**:

```
  A  event bar       vendor's marked bars == ours, exactly (4 UP, 3 DN)
  B  placement       BelowBar/AboveBar/Absolute == belowBar/aboveBar/inBar
  C  dynamic colour  vendor compiles it to a per-bar palette index; so do we
  D  text/glyph/size "U" "D" "X" small  ==  "U" "D" "X" 0.8
```

⚰️⚰️ **AND IT DISAGREED ON ITS FIRST RUN.** `pine.js` mapped `color.red` to
`#F23645` — the chart's **down-candle** red — under a comment asserting the table
held the vendor's own hexes. TradingView's answer is `#FF5252`. Six of the seven
colours the observation reaches matched exactly; red did not.

⛔⛔ **NO RAIL IN THE REPOSITORY COULD HAVE FOUND THIS.** Every colour test
asserted OUR constant, so the wrong red was the expected red everywhere and the
provenance claim in the comment was checked by nothing —
`lesson_a_green_suite_does_not_mean_a_true_number`, in the one place the repo had
explicitly written down that it must not happen. Fixed, three rails updated, and
all seven reachable colours now pinned to the vendor's own answer.
Mutation-checked: restoring `#F23645` turns the new rail red.

⚠️ **What it does NOT settle:** pixels (it reads TradingView's rendering model,
with the eye-checks recorded separately as prose in `vendor.visualFacts`), glyph
shape (triangle → arrow stays a declared approximation), and the other nine
members of the parity set. H1's numbers are unchanged.

⭐ Method note worth keeping: **a `plotshape` carries a value per bar in
TradingView's data model** — 1 where the glyph draws, 0 where it does not. That
turns "did it land on the right bar" from a question about a screenshot into an
array comparison, and it is why this capture is `confirmed` rather than "the
pictures look similar".

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

### H6 — 🔴 `tools/vendor_truth.py --check` CRASHES AT HEAD, and 22 green tests cannot see it

**Found while closing H2, NOT by any rail. Not fixed here — it is another
workstream's ruling to make. Reported so nobody quotes the tool as green.**

```
$ python tools/vendor_truth.py --check
==============================================================================
VENDOR TRUTH
==============================================================================
Traceback (most recent call last):
  ...
  File "tools/vendor_truth.py", line 203, in compare
    delta = float(got) - float(want)
TypeError: float() argument must be a string or a real number, not 'dict'
```

**Cause.** `32046d04c` (2026-09-07, the vendor-backed-builtins batch) added four
observations whose `vendor.values` map a bar to a **dict of named candidate
columns** rather than to a scalar:

```
  ta-accdist-delta5-2026-09-06   {'ad_change5': …, 'ad_deltaSumCandReal5': …}
  ta-falling-close3-2026-09-06   {'falling_real_builtin': …, 'falling_real_candMonotone': …, …}
  ta-kcw-close20-2-2026-09-06    {'kcw_builtin': …, 'kcw_candRatio': …, 'kcw_candPercent': …}
  ta-pvt-delta5-2026-09-06       {'pvt_change5': …, 'pvt_deltaSumCandReal5': …}
```

All four also carry an `engine.ast`, so `check()` classes them **parity-comparable**
and calls `compare(obs)` with no `column=` — and `compare` reads
`obs["vendor"]["values"]` as scalars. `compare` HAS a `column` parameter for
exactly this, and nothing passes one.

⛔⛔ **AND THE RAIL IS GREEN.** `tests/test_vendor_truth.py` is 22/22 passing —
because **every one of its cases monkeypatches `OBS_DIR` to a `tmp_path`**. Not
one test runs `check()` against the store the repository actually holds. So the
harness is verified to work on fixtures it invents and is verified against
nothing it ships, which is `lesson_a_green_suite_does_not_mean_a_true_number`
wearing the exact costume this directory exists to strip off. The one-line rail
that would have caught it — *run `check()` on the real store and assert it does
not raise* — is the kind of test the repo has repeatedly discovered it was
missing.

**Why it is not fixed here.** Reading a multi-column observation means deciding
**which named column is the vendor's answer** and which are our competing
candidate readings. That is the whole subject of the oracle-ambiguity work that
produced these files (the four are also the only four with no counterpart under
`tests/fixtures/vendor/parity/`, so their authors already knew they were a
different kind of object). Guessing it from outside would put a second authority
on their ruling — the defect class this register names more than any other.

**Two things the fixer must decide, in this order:**
1. Does a multi-column observation belong in `observations/` at all, or in its
   own directory the way `visual/` now is? `load_observations`'s shape check is
   the natural place to refuse the shape it cannot read.
2. If it stays, `check()` must select the vendor-answer column per observation —
   and the selection has to be declared IN the observation, not inferred from a
   name, or the tool becomes a second authority on the ruling.

⚠️ Also unread: **nothing in the repository reads `tests/fixtures/vendor/parity/`**
(18 files). Grep for the path returns no consumer. Either it is an artifact
directory that should say so, or a reader was intended and never landed.

---

## PART I — C3B, THE GRAPHICAL-OBJECT MODEL (2026-09-08)

### I1 — the census that changed the build

Two populations, never mixed. **46/60 demand objects; 27 of those are
execution-reachable; C3B targets the 27.**

⭐⭐ **THE REACHABLE POPULATION IS TABLE-DOMINATED — 19/27 scripts, 227 cell
sites, more than line, box and linefill combined.** The 46-script headline hides
this completely (line and label lead there). A wave built to the headline would
have shipped a line/label engine and served two thirds of nobody.

⭐ **And collections collapse from 23/46 to 7/27** — sixteen of the twenty-three
are loop-blocked, because an object array is overwhelmingly something authors
fill inside a `for`. Built anyway, small: five operations, bounded by
construction.

### I2 — what was built, and what it reaches

`objectProgram.js` (model) · `objectRuntime.js` (evaluator) ·
`objectRenderState.js` (generic state) · `objectCanvas.js` (pure painter) ·
`objectLayer.js` (one canvas per instance) · `objectColumns.js` (graph → columns)
· `pineObjects.js` + `pine.js` (translation), wired through `binder.js` into
`StockChart.jsx` and saved by `BuilderSheet.buildDefinition`.

```
  scripts yielding an object program   23/60
    …of the reachable 27               18/27
    …of the loop-blocked 19             5/19  (their non-loop ops only)
```

⛔ Of the 9 reachable scripts with no program, **five do not translate at all**
for reasons that predate C3B (UDTs, loops in the VALUE lane). Object reachability
is not script translatability, and merging them would credit C3B with a failure
it did not cause.

### I3 — ⚰️ THE `var` BUG, AND WHY ONLY THE LADDER COULD FIND IT

Pine's `var x = <expr>` initialises **once**. The translator emitted it as an
unguarded create, so `var table t = table.new(…)` minted a NEW table on every
bar: 300 bars, 300 tables, the 8-table envelope blown by bar 8, and the whole
indicator refused with `OBJECT_LIMIT_EXCEEDED`.

⛔⛔ **Every unit test of the runtime passed. The model was right; the translator
was wrong about the commonest object initialiser in the corpus.** What caught it
was Level 9 of the capability ladder — a real dashboard over 300 real bars. A
level built from a two-bar fixture would have been green.

### I4 — three flags that could have been values, and must not be

`lastBarOnly` (`barstate.islast`), `once` (`var`), `requiresLive`/`requiresEmpty`
(`na(handle)`). Each is answerable by the RUNTIME and unanswerable by a pure
graph, so each is lifted OUT of the expression into a flag — where no tree, no
hash and no screener column can contain it. `barstate.islast` in particular stays
correctly refused for a screener column, where "the last bar" would depend on how
many bars the request asked for.

### I5 — text is a value kind, and the measurement forced it

The first build was numeric-only and reached **6 of 27**. A table is made of
strings and the V2 graph is numeric by construction, so text became a small
expression tree whose LEAVES are graph nodes — the numbers keep one authority.
6 → 14 with text and colour; 14 → 18 with block-local scope (the corpus binds a
cell's text inside the same `if` that draws it).

⛔ A cell whose text cannot be read is DROPPED, not blanked: an empty cell reads
as "the value is empty", which is a worse claim than "we could not import this".

### I6 — 🔴 THE THREE OPEN GATE ITEMS ARE ALL EVIDENCE

```
  11  real chart rendering       WIRED, NOT PHOTOGRAPHED
  12  TradingView object parity  NOT TAKEN
  13  parity set remeasured      NOT RE-RUN
```

They are one piece of work. The C3A-CLOSE vendor method already works and would
transfer directly (TradingView's chart model exposes object state per bar the
same way it exposed marker state). Until item 13 runs, **fidelity is NOT
re-graded** — "18/27 translate" is a translation number, and calling it a
fidelity improvement would be the `CHART_RENDERABLE`-as-`VISUAL_FULL` substitution
C3A-CLOSE forbade.

### I7 — cost

```
   objects   evaluate   renderState     paint       (5,000 bars)
         1      5.4ms        0.89ms      0.59ms
        10     13.7ms        0.29ms      0.07ms
       100    117.1ms        0.27ms      0.23ms

   5,000 create/delete cycles  7.7ms, peak live 1
   60-cell dashboard           10.4ms, 61 ops executed (not 300,000)
```

⭐ `lastBarOnly` is the dashboard performance story, with its control measured.
⚠️ The 100-object row is a pathological program (100 lines updated on every one
of 5,000 bars); cost is linear in operations, not quadratic in bars.


---

## PART J — C3B-CLOSE: WHAT THE LIVE PRODUCT, THE VENDOR AND THE PARITY SET SAID (2026-09-08)

Full report: `C3B_CLOSE_LIVE_VENDOR_AND_PARITY.md`. This register carries the
gaps; that document carries the evidence.

### J1 — the three C3B gate items are answered

```
  11  real chart rendering        ✅ 9/9 live fixtures, real pixels, after reopen
  12  TradingView object evidence ✅ VENDOR_CONFIRMED, first object observation in the repo
  13  fixed 10-member parity set  🟡 re-run: 8/10 draw+reopen · 5/10 paint · fidelity UNMEASURED
```

⛔ **AND THE FIVE THAT PAINTED ALL PAINTED TABLES.** No line, label or box was
drawn by any parity-set member. `5/10 painted` is a true sentence about tables
and a false one about drawings — the per-script classification in the closure
document is the honest form, and this line exists so the bare fraction never
travels on its own.

### J2 — ⚰️ TWO DEFECTS THE OBJECT LANE HAD, THAT ONLY A PARAMETER COULD FIND

**(a) `objectColumns.js` called `interpret` with an empty INPUTS map.**
`interpret(ast, bars, inputs, budget, scalars, opts)`; the object lane passed
`interpret(tree, bars, opts.interpretOpts || {})` — an empty object in the
`inputs` position, no budget, no timeframe. `interpret` seeds its scope from
`inputs` **by name**, so a definition declaring a member input and reading it in
an object's coordinate resolved that name to nothing and the whole column
refused, while the plot beside it honoured the same knob through
`nativeRegistry.computeFor`'s `resolveInputs`. One document, two evaluators, one
of them deaf.

**(b) `pine.js`'s object pass ignored `declareInputs`.** The output loop sets
`resolver.declareInputs`/`inputValues`; the object pass's resolver factory did
not. On ONE call with `{declareInputs: 'all'}` the plot came back
`close * (1 + off / 100)` and the object's y-coordinate came back
`close * (1 + 5 / 100)`.

⛔⛔ **NEITHER WAS VISIBLE TO ANY RAIL, AND THE REASON IS THE SAME BOTH TIMES:
every object test builds its trees out of LITERALS**, where an empty inputs map
is the correct one, and the eight original live fixtures carry no member input at
all because their only `input.int` sits in a WINDOW slot, which this engine folds
by design. It took a fixture whose knob sits in an ARITHMETIC position.
Rail: `objectParams.test.js`, with a mutation control asserting an empty inputs
map still makes the referenced node FAIL.

### J3 — ⚰️ THE PROBE THAT MEASURED THE VALIDATOR INSTEAD OF THE MODEL

`tools/c3b_param_probe.py` first drove `len` on a `ta.sma(close, len)` script — a
window slot, therefore never a member knob, therefore not a declared input on the
saved definition. Writing `inputs.len` made `instances.js` refuse the whole
instance (correctly, fail-closed) and the chart lost the indicator: no chip, no
object layer, `pixels_after: []`. **That reads exactly like "the object did not
survive a parameter change".**

Two instrument fixes, both worth copying elsewhere:
- **check the premise before measuring** — the probe now reads the definition's
  declared inputs and returns `NOT_MEASURED` with a reason rather than a number;
- **scope every reading to this run's own instance id** — a previous run's
  revived instance stays on the chart by design, and unscoped the probe read a
  STALE layer's coordinate and reported `object_moved: false` while the layer
  that belonged to the run had moved.

### J4 — ⚠️ A CORRECT DRAWING OFF THE TOP OF THE PANE READS AS A FAILURE

A `close * (1 + off/100)` fixture reported `drawn: line:1`, `bbox.y0: -16`,
`pixels: 0`. The renderer was right; the object was sixteen pixels above the
pane. **A pixel count alone cannot tell "drew nothing" from "drew off-screen"** —
the `bbox` and the `selfTestPixels` discriminator beside it are what make the
zero interpretable. Any future pixel probe needs both.

### J5 — NEW GAPS, NAMED AND NOT FIXED

| id | lane | statement |
|---|---|---|
| **J5.1 (H7)** | VALUE / EXPRESSION GRAMMAR | **`%` (modulo) is not in the expression grammar.** Classified per the wave's instruction as a VALUE-LANE gap, **not an object-model gap**: an object coordinate using `%` fails for exactly the reason a plot using `%` fails. Deliberately not implemented during C3B-CLOSE. |
| **J5.2 (H8)** | VALUE / BUILTINS | **`last_bar_index` has no column.** It is in `PINE_KNOWN_BUILTINS`, so the refusal is named rather than "undefined", but nothing resolves it — so any guard using it drops its op, fail-closed. This is the SOLE cause of the one divergence in the whole vendor comparison: TradingView draws three labels there and we draw none. |
| **J5.3 (H9)** | DOCUMENT SHAPE | **A script that only draws does not translate.** No `plot()` ⇒ no output ⇒ nothing to register. The vendor's own object probe has no plot; the parity rail adds one and says so. An object-only indicator is an ordinary TradingView shape. |
| **J5.4 (H10)** | OBJECT / DISCLOSURE | **A dropped op is silent to the member.** The ledger records every reason (`guard:create`, `cell:text`, `update:props`, `cell:address`, `delete:target`) and real parity-set scripts lose 8–42 ops each — but nothing surfaces those counts in the Builder. **A script can import, save, reopen and draw a table while quietly losing every line it asked for, and the product says nothing.** The information exists; the door does not. |

### J6 — WHAT THE VENDOR CONFIRMED, IN ONE PLACE

`tests/fixtures/vendor/visual/object-semantics-spy-1d-2026-09-08.json`, rail
`vendorObjectParity.test.js` (14 cases). SPY · 1D · NYSE Arca, read out of
TradingView's own chart model (`graphics().dwg*()` primitive records plus the
study's resolved `palettes.palette_common`), study removed afterwards, layout not
saved.

- **identity is ONE monotonic counter shared by every family** — bar 0 mints
  line=1, line=2, table=3 in script order; there is no per-family id space
- **an updated object keeps its id** — the `set_xy`-moved anchor is still id 1
  after ~8,458 bars; the per-bar recreated line is 8462. Both numbers are needed:
  neither engine shape can produce the other's
- **delete really removes** — ~8,458 created, exactly one alive
- **a coordinate is read from the bar the object was CREATED on**, not the bar it
  is drawn at — four boxes forty bars back all use the last bar's high/low
- **x is a position into a per-study index table**, not a bar index or a timestamp
- **`bar_index` is absolute over loaded history**, not the chart window
- **a table is pane-anchored with no coordinates**; **a cell references its table
  by id**
- **the colour palette matches ours eight for eight**, and index 1 = `#FF5252`
  **independently re-confirms the C3A-CLOSE `color.red` correction** from a
  different surface in a different capture

⭐ Our engine reproduces every one of those structural facts on the vendor's own
script — the anchor's id, the table's id, the 20-bar span, the four box spans,
the high/low sourcing rule, two lines alive, three colours. **The single
divergence is J5.2, and it is in the value lane.**

### J7 — the ordering this changes

The object model is **not** what is holding the parity set back, and the evidence
says so three ways: two of ten never reach the engine (`pine:function`,
`pine:state`); of those that do, the geometry families are lost to a `pine:tuple`
refusal upstream of every guard, one dropped `create:box`, and the loop boundary;
and the vendor comparison on a script the model handles perfectly diverged on
exactly one missing VALUE-lane builtin.

**⭐ The next wave that moves the governing objective is a COMPATIBILITY wave —
the expression and statement grammar (tuples, user functions, `%`,
`last_bar_index`, the `pine:state` family) plus J5.4 — not another object wave.**

---

# PART K — C4 PHASE 1: the measurement that reorders the program (2026-09-08)

Evidence: `C4_PHASE1_ARCHITECTURE_AND_MATRIX.md`. Instruments:
`tools/c4_pine_surface_census.mjs`, `tools/c4_vm_feasibility_probe.mjs`.

### K1 — ⛔⛔ ACCEPTANCE HAS NOT MOVED IN EIGHT COMMITS

Re-measured at HEAD on all five in-repo corpora: OOS 18/60 · blind 27+9/48 ·
community 18/30 · parity 5/10 · curated 14/21 — **identical to post-Wave-A**.
Wave B, C0R, C1, C2B/C/D, C3A and C3B moved ZERO scripts across the line. Each
wave did what it set out to do; the number says where the wall is, and it is not
where any of them were digging.

### K2 — ⛔⛔ ACCEPTANCE IS NOT TRANSFER

52 of 91 accepted scripts (57%) carry a silent-false-success probe flag:
`P4_visuals_dropped` 37 · `P1_P2_state_present_but_accepted` 33 ·
`P5_output_shortfall` 21 · `P3_request_present_but_accepted` 14 ·
`P7_constant_column` 11. The shortfall is arithmetic, not judgement:
**21 accepted scripts declare 246 visual calls and carry 168 — 78 lost.**
⚠️ Flags are DETECTIONS. Nothing here is reclassified SILENT_WRONG without
adjudication.

### K3 — ⭐⭐ THE CEILING IS IN THE ARTIFACT, NOT THE WALKER

`NODE_TYPES` is eight entries and **all eight are expressions** (`parse.js:171`,
pinned identically at `ast_interpret.py:112`, validated again by `graph.js`).
There is no statement, assignment, block, scope, loop, array or UDT node — so
imperative Pine has nowhere to be **written down**, in the tree, the V2 graph or
a saved definition. Bar-to-bar state exists only as a `recurrence` declared in
`closedTable.json`, and **1 of 70 functions declares one** (`accum`).
**65% of 159 real scripts (104) demand semantics that model cannot hold.**
Only 35% (55) are pure expressions — and the engine already accepts 42 of them,
so Option A's entire remaining prize is ~13 scripts.

### K4 — ⚰️ A CORRECT, GENERALIZED GRAMMAR FIX BOUGHT EXACTLY ZERO

H7/J5.1 closed: `%` now lowers to `cCall('mod', …)` — three lines, no new node
type, no second arithmetic authority (`closedTable.operators` still has no `%`,
and the test asserts that absence). Re-measured across all five corpora:
**91 → 91 accepted, 761 → 761 outputs, 224 → 224 usable.** Eleven scripts demand
`%`; five were already accepted, six are blocked by `pine:tuple`,
`pine:character`, `pine:no-output` ×2, `pine:function-def`, `pine:builtin`.
⭐⭐ This is §64 demonstrated instead of argued, and it is why Phase 1 stopped
rather than prove it five more times on `last_bar_index` and `create:box`.

### K5 — ⚰️ THE `%` RAIL FOUND AN ADJACENT HONESTY DEFECT BY BEING WRONG

The non-vacuity control asserted `close ^ 3` refuses with `pine:operator`. It does
not — the **lexer** rejects `^` first with *"Pine has no character like this one"*,
about a character Pine has. Same guard, same wrong message as the 4/60 OOS-2
scripts using `f(...).field`. Recorded in `pine.modulo.test.js`, which goes red
when the lexer guard is corrected. **Still open.**

### K6 — ⭐ THE VM PERFORMANCE OBJECTION DOES NOT SURVIVE A NUMBER

`tools/c4_vm_feasibility_probe.mjs`, four shapes running the same program with an
agreement control that must pass to 1e-9 before any timing prints (it fired on the
first draft). 5,000 bars × 120 ops: columnar-reused 0.49 ms · **bytecode 1.37 ms
(2.78×)** · tree walk 2.44 ms (4.96×) · columnar-allocating 2.08 ms.
⚰️ Against the ALLOCATING shape the VM reads as *faster* (0.66×) — an artefact of
allocation, which is why the reused-buffer control exists.
**274 ns/bar ⇒ a 5,000-symbol × 300-bar scan is 0.4 s single-threaded** (1.4 s at
500 ops/bar). A floor, not a budget — no na-handling, bounds checks, arrays or
object emission.

### K7 — NEW GAPS, NAMED AND NOT FIXED

| id | lane | statement |
|---|---|---|
| **K7.1** | LEXER / HONESTY | `^` (and `f(...).field`) refuse as `pine:character` — "Pine has no character like this one" about characters Pine has. Mischaracterised refusal, 4/60 OOS scripts + every unsupported operator. |
| **K7.2** | INPUTS | **`input.string` is the largest unserved input type — 45 scripts (28%)**, and it is usually a MODE SELECTOR, so it is entangled with `switch`/`if` rather than independent. |
| **K7.3** | VERSIONING | The corpus is v6 110 · v3 13 · v5 12 · v4 9 · v2 2 · none 13. **"Target v5/v6" understates the tail: 22% declare `study()`.** No version-specific semantics are represented anywhere today. |
| **K7.4** | CROSS-FEATURE | **30 scripts (19%) need array+loop+UDF+object SIMULTANEOUSLY.** A roadmap shipping those families one at a time delivers nothing measurable until the last lands — so Phase 2 Tasks 3–7 must be judged by conformance coverage, not corpus acceptance. |
| **K7.5** | ARCHITECTURE | **The two-kernel decision (§47) is the largest open risk in Phase 2** and is UNMADE. Implementing scopes/frames/loops/arrays twice would diverge exactly where it is invisible. |

### K8 — the ordering this settles

Option A cannot terminate at the objective; extended far enough it BECOMES
Option B, arriving as accreted special cases instead of a design. The decision is
**B in its hybrid form**: one version-aware front end lowering into the existing
columnar graph (kept — 2.7× faster on what it can express, cross-kernel verified)
for pure expressions, and a bounded bar-by-bar runtime for everything imperative,
emitting into C3B's object program. **Phase 2 requires owner authorization.**

---

# PART L — 2D-2: real Pine source reaches the runtime (2026-09-08)

Evidence: `PINE_LANGUAGE_RUNTIME_COMPLETION_MATRIX.md`,
`PHASE2_RUNTIME_ARCHITECTURE.md`. Instrument:
`ast/runtimeFrontendCoverage.test.js`.

### L1 — ⭐⭐ 27 REAL SCRIPTS NOW EXECUTE THROUGH SOURCE → IR → BAR LOOP

blind 19/48 · community 5/30 · curated 3/21 · OOS-1 0/60. And where both lanes
describe the indicator they AGREE, paired output-for-output at 1e-9: 18/19, 5/5,
3/3. Acceptance in the shipped product is unchanged and that is by design (§48) —
the runtime lane is not wired to the chart or the screener.

### L2 — ⭐⭐ ALL TEN STATE-BLOCKED OOS SCRIPTS ADVANCED PAST STATE

The transition §54 asked for. Six now stop at `runtime:function`, one at
`runtime:call-with-state`, two at `pine:text-value`, one at `pine:statement`.
**`pine:state` and `pine:reassign` are no longer the wall for any of them.**

### L3 — ⭐⭐ UDFs ARE THE WALL, BY 2.5× OVER THE NEXT FAMILY

Next-dependency census on the frozen 60: `runtime:function` **18** ·
`runtime:call-with-state` 7 · `runtime:presentation` 5 · `pine:text-value` 5 ·
`pine:character` 4 · `pine:block` 4 · `pine:collection` 3 · `runtime:udt` 3 ·
others ≤2. This is the single most useful number the wave produced and it names
the next subwave.

### L4 — ⚰️ A DIFFERENTIAL THAT COMPARED TWO DIFFERENT THINGS

The first version of the real-source differential took the shipped door's first
NON-HIDDEN output and compared it to the runtime's first SOURCE-ORDER output. On
`02-wavetrend-oscillator-lazybear` that is output 5 against output 0, and it
reported `worst: 54` as a runtime defect. **The rail was wrong, not the runtime.**
⛔ It now requires the output ROSTERS to match before comparing anything, and
compares index-for-index. A differential that compares two different things is
worse than none: it manufactures findings, and by the time a real one arrives it
has taught everyone to discount them.

### L5 — 🔴 OPEN: ONE GENUINE LANE DIVERGENCE, PENDING A VENDOR PIN

`recency-pullback-down-streak` (blind). The shipped door rewrites `downRun >= 3`
into `close < close[1] && (close < close[1])[1] && (close < close[1])[2]`; on bars
0-1 the `[2]` term reads before history exists, and this engine's `logical`
PROPAGATES `na`, so the plot is `na`. The runtime keeps the real counter — `close
< na` is 0 (`cmp` answers 0), so `downRun` is 0 and the plot is 0.
⛔ **BOTH LANES ARE INTERNALLY CONSISTENT AND THE TIE IS PINE'S TO BREAK.** Pine
documents comparison against `na` as false, which would make the runtime right and
put a two-bar warm-up difference into every script using the bounded run-length
rewrite — but that is a claim about the VENDOR and this wave captured no vendor
evidence. Exempted BY NAME in the rail, with a second test asserting the exemption
is still needed so it cannot rot into permanent permission to differ.
**→ §55 vendor capture programme.**

### L6 — ⚰️ A FAMILY MISCLASSIFICATION THE FIRST MEASUREMENT EXPOSED

The front end initially filed `fill()`, `bgcolor()` and `max_bars_back()` under
`runtime:expression-statement` — technically true and useless: it put a
PRESENTATION gap and a COMPILER DIRECTIVE in the row reserved for effectful calls,
so the completion matrix would have shown work where there is none and hidden work
where there is. Statement-level calls are now three families:
`runtime:presentation`, `runtime:directive`, `runtime:expression-statement`.

### L7 — NEW GAPS, NAMED AND NOT FIXED

| id | family | statement |
|---|---|---|
| **L7.1** | RUNTIME / FUNCTIONS | `runtime:function` — 18 of 60. Call frames with per-CALL-SITE persistent slots (Pine's function-local `var` persists per call site, not per function). The next subwave. |
| **L7.2** | RUNTIME / SERIES BRIDGE | `runtime:call-with-state` — 7 of 60. A windowed builtin fed by a mutable variable. Distinct from state support and separately schedulable. |
| **L7.3** | RUNTIME / HISTORY | `runtime:history-variable` — `x[1]` over a slot. Refused, never approximated: reading the slot's current value is silently one bar wrong on every bar. Integration point is the slot table, whose identity is already stable. |
| **L7.4** | RUNTIME / PERSISTENCE | A runtime program is **not persisted at all** yet. No artifact version, no save/reopen journey. Legacy V1/V2 documents are untouched and unmigrated, so nothing is at risk — but §42's journey is NOT done and is not claimed. |
| **L7.5** | FRONT END / DIAGNOSTICS | `pine:character` on `^` and on `f(...).field` is still mischaracterised (PART K, K7.1). 2D-2 did not fix it: the new front end reuses the same lexer, so those 4 OOS scripts still meet the same wrong message. Investigated and located; correcting the character class is its own change with its own blast radius. |

---

# PART M — 2E: Pine functions get real execution semantics (2026-09-08)

Evidence: `PINE_LANGUAGE_RUNTIME_COMPLETION_MATRIX.md` (UDF fine grain).
Instrument: `ast/runtimeFrontendCoverage.test.js`.

### M1 — ⭐⭐ `runtime:function` 18 → 0 ON THE FROZEN 60

Every function-blocked script now compiles its functions and reaches its next
true dependency. Where they went: `runtime:call-with-state` 8 · `pine:block` 5 ·
`pine:builtin` 2 · `pine:statement` 1 · `pine:text-value` 1 · `pine:collection` 1.
⚠️ **Executed counts did NOT move** (blind 19, community 5, curated 3, OOS 0) and
that is the expected shape (§42) — the wall moved, not the total.

### M2 — ⭐⭐ PERSISTENT FUNCTION-LOCAL STATE IS PER CALL SITE, AND IT IS PROVEN

`CALL a b` carries BOTH the function and the call site; `persistBase` comes from
the site. `f(1)` and `f(10)` on two lines are two independent `var`s — asserted
behaviourally (independent accumulators) AND structurally (distinct bases), with
the IR validator refusing two sites that share a base.
⭐ **Mutation-proven**: replacing `persistBase = site.persistBase` with `0` turns
the rail red; the file was restored byte-identically (sha256 verified), never by
`git checkout` — `feedback_mutation_check_never_git_checkout`.

### M3 — ⚰️⚰️ `runtime:call-with-state` WAS THREE CAPABILITIES WEARING ONE LABEL

It became the top blocker at 15 after 2E, and the names underneath it were `na`,
`nz`, `math.max`, `int`, `str.upper` **beside** `ema`, `sma` and
`request.security`. Those are a POINTWISE apply, a growing SERIES, and an MTF
REQUEST — three separately-schedulable capabilities of very different size, and
one label made them look like one wall.

Split (§29) into `runtime:call-pointwise-state` **8** ·
`runtime:call-windowed-state` **6** · `runtime:request-with-state` **1**.
⭐ **The pointwise 8 are the cheapest real capability left in the census**: they
need a per-bar apply of a function the closed table already declares pointwise —
no series, no bridge.
⚠️ The namespace strip that classifies them is a documented HEURISTIC and affects
only a LABEL: `pine.js`'s authoritative name mapping is not exported, so a
mislabel misfiles a row in the matrix and can never change a number.

### M4 — 🔴 OPEN: THE VENDOR PIN §53 REQUIRED WAS NOT TAKEN

Per-call-site persistence is implemented from Pine's documented semantics and is
**UNPINNED**. §53 asks for a deterministic TradingView oracle — one stateful
helper called from two source call sites — and this wave captured none.
⛔ **The 2E exit gate item 21 is therefore NOT met**, and the matrix row reads
`VENDOR VERIFIED ⬜` rather than being quietly omitted. It is the single most
consequential unpinned semantic in the runtime: if Pine shares state per
FUNCTION rather than per call site, every multi-call helper computes the wrong
number and nothing here would catch it.

### M5 — NEW GAPS, NAMED AND NOT FIXED

| id | family | statement |
|---|---|---|
| **M5.1** | RUNTIME / BUILTINS | `runtime:call-pointwise-state` — 8 scripts. A pointwise builtin applied to a mutable value. Cheapest remaining capability. |
| **M5.2** | RUNTIME / SERIES BRIDGE | `runtime:call-windowed-state` — 6 scripts. A windowed builtin fed by a growing series. |
| **M5.3** | RUNTIME / FRAMES | `runtime:function-global-state` — a function body reading a mutable GLOBAL. A frame has no address for a caller's slot; the plausible shortcut reads a DIFFERENT variable. |
| **M5.4** | RUNTIME / FUNCTIONS | Default parameter values refuse `runtime:function`. |
| **M5.5** | RUNTIME / FUNCTIONS | Tuple return, array/object arguments: the ABI is a general Pine value rather than a numeric register, so they are **ready but not built**. |
| **M5.6** | PERSISTENCE | Still no persisted runtime artifact and no version (carried from L7.4). Call-site identity is a deterministic ordinal over a deterministic traversal — stable for unchanged source, and it MUST become part of the artifact contract before anything is saved. |

---

# PART M-CLOSE — the vendor pin (2026-09-08)

### M4 IS CLOSED — ⭐⭐ TRADINGVIEW CONFIRMS PER-CALL-SITE FUNCTION STATE

Fixture `tests/fixtures/vendor/runtime/callsite-state-spy-1d-2026-09-08.json`;
rail `runtime/__tests__/vendorCallSiteState.test.js`.

SPY · 1D · NYSE Arca · 300 bars · 2025-06-30 → 2026-09-08. One stateful helper
called from two source call sites:

```
A step {1} · B step {10} · B/A exactly {10} · 0 rows deviate    (v5 AND v6)
```

Shared-per-definition state would have produced A stepping by 11 with B−A a
constant 10. It did not. **UCT's implemented model is vendor-confirmed and 2E
exit-gate item 21 is met. 2E IS FULLY CLOSED.**

⚠️ The absolute counters read ~8,160 rather than 1 because TradingView
accumulates over its full loaded history, not the visible window. **The steps and
the ratio are the evidence; the absolutes are an artefact of history depth**, and
the rail asserts only the former.

### ⭐ AND `%` IS VENDOR-PINNED AS TRUNCATED

`-7 % 2 = -1` · `7 % -2 = 1` · `-7.5 % 2 = -1.5` · `-7 % -2 = -1`. The sign
follows the DIVIDEND. Phase 1 lowered `%` onto the table's `mod` from
documentation alone and said so; the oracle now agrees, and a borrowed Python `%`
(which answers +1 for `-7 % 2`) is positively excluded.

### ⚰️⚰️ THE PROCESS LESSON — WHY THE FIRST ATTEMPT WAS STOPPED

The first capture ran in a BACKGROUNDED tab and every editor-write path failed
while *reporting success*: `execCommand('insertText')` returned `true` and landed
nothing visible, the DOM showed a stale script, and **`Add to chart` compiled a
leftover probe from a previous session**. Values read then would have been
recorded as TradingView's answer about a script nobody wrote.

⛔ **THE RULE THIS ESTABLISHES: prove the COMPILED STUDY IDENTITY from the model —
`shortDescription`, plot count, plot titles, and the absence of stale studies —
before accepting a single value.** The editor DOM is rAF-rendered and is not
evidence of what compiled. Both captures here carry that proof in the fixture.

---

# PART N — 2F-1: POINTWISE CALLS OVER RUNTIME STATE (2026-09-08)

HEAD at entry `2f75addb5`. Suites: `src/components/chart/engine/runtime`
**123 passing** (6 files); whole engine **4,387 passing / 1 failing**, the failure
pre-existing at HEAD and named in N6.

### N1 — ⭐⭐ THE CAPABILITY IS BUILT, AND IT EXECUTES

A builtin that depends on nothing but its current-bar inputs now runs against a
value the runtime mutated. `EXPR.BUILTIN` in the IR → `OP.POINTWISE` in the
program → the VM applies `interpret.js`'s own `POINTWISE_FOR_PARITY` scalar per
bar. `math.max(x, 5)`, `math.min`, `abs`, `sign`, `round`, `sqrt`, `pow`, `mod`,
`idiv`, `sin`, `cos`, `exp`, `ln` (reached as `math.log`), `log10`, `na` and `nz`
all execute over state, inside UDF bodies, inside branches, and in both
directions of composition (state → pointwise → state, stateful-UDF → pointwise →
stateful-UDF).

⛔ **NO SYNTHETIC HISTORY.** A pointwise function needs only this bar's values, so
nothing materialises a fake column to reuse a columnar implementation. `sma`,
`ema` and friends over state stay refused.

### N2 — ⭐⭐ THE CLASSIFIER IS FIVE AUTHORITIES AGREEING, NOT A NAME HEURISTIC

`pointwiseTarget` executes a call only when **all five** agree it is pointwise and
implemented: `VALUE_NAMESPACES` (pine.js's own namespace set) · `PINE_CALL_SHAPES`
(pine.js's own Pine-name → table-name mapping) · `TABLE.functions` · `isPointwise`
(parse.js's own predicate) · `POINTWISE_FOR_PARITY` (interpret.js's own scalar).
Nothing here is a second catalog.

- A namespace outside `VALUE_NAMESPACES` is **never stripped** — `str.length` can
  never collide with a table entry called `length`.
- A `PINE_CALL_SHAPES` entry is admitted **only if its `build` is an identity
  passthrough**. A shape that rearranges, injects or synthesises arguments is a
  REWRITE, and applying it by passing Pine's arguments straight through would
  compute a different function. Fails closed.
- `nz(x)` is `nz(x, 0)` — **mirroring pine.js's own ruling**, not inventing a
  default.
- `int()` is deliberately EXCLUDED. `pine.js` records that cast as
  written-and-taken-back-out (TradingView does not publish whether it truncates,
  rounds or floors), so implementing it in the runtime lane alone would create a
  cross-lane divergence under the member's own title.

⚠️ The identity-build guard is currently **unreachable from Pine source** — no
rewrite shape names a pointwise table. Rather than fake a call, the rail asserts
the PROPERTY over the shipped tables (`pointwise.test.js`), with a two-way
non-vacuity control: the predicate must call `max` identity and `stoch`/`atr`
not, and the loop must actually have found pointwise-reachable shapes to judge.

### N3 — ⭐⭐ MEASURED: `call-pointwise-state` **14 → 0**, BY NAME, ON THE SAME INSTRUMENT

Not by histogram arithmetic. The classifier was fitted with a kill switch, all
five corpora re-measured with it armed, and `pineRuntimeFrontend.js` restored
**byte-identically** (sha256 `a95c62080b9edf9521f6697f6fb1f5ae42eb33cb2bc9b6a06513022ecc80c702`),
never by `git checkout` (`feedback_mutation_check_never_git_checkout`).

⭐ **The armed run reproduced the recorded 2E number exactly (OOS-60 = 8)**, so it
is the mutation control as well as the baseline: with the pointwise path off, the
fourteen come straight back.

OOS-1 **8 → 0** · curated 3 → 0 · community 2 → 0 · parity 1 → 0 · blind 0 → 0.

⭐ **All fourteen were genuinely pointwise** — §14's condition is met. Every one
moved to a NEW, further dependency; none regressed and none began executing with
an unproven number. Executed counts are unchanged (27/169), which is the expected
shape (§42): what moved is the wall.

### N4 — ⚰️⚰️ THE RESIDUAL BUCKET WAS NOT ONE FAMILY EITHER (the correction §14 asked for)

With the pointwise 14 gone, `runtime:call-windowed-state` was re-read BY NAME and
held `str.upper`, `int`, `iff` and `cum` beside `ema`, `sma` and `wma`. Measured
against `TABLE.functions`: three of the four are **not declared by the closed
table at all** (so their wall is the builtin existing, not the series bridge) and
one is a numeric cast.

Split into `runtime:call-text-state` · `runtime:call-conversion-state` ·
`runtime:call-undeclared-builtin-state`, and `str.` is now read BEFORE the
namespace strip rather than after — stripping first is exactly what let
`str.upper` be filed as a windowed series function.

**The series bridge is 9 scripts, not 13** (OOS-60: 6 → 4). This is the same
defect 2E fixed one level up. ⛔ **A residual bucket is a hypothesis, not a
family, until someone reads the names in it** — and the label-only heuristic that
files these is documented as a REPORTING device precisely so a mislabel misfiles
a matrix row and can never change a number.

### N5 — ⭐⭐ THE CAPABILITY THIS WAVE EXPOSED: `runtime:history-variable`

Six of the fourteen land on it (`supertrend` ×2, `heikin-ashi-candle-overlay`,
`klinger-volume-oscillator` ×2 corpora, `chandelier-exit`), and it was invisible
while the pointwise wall stood in front of it. History over a MUTABLE variable
needs a per-slot ring buffer committed at end of bar; `lowerIr.js` refuses it by
name rather than approximating it with the slot's CURRENT value, which would be
silently one bar wrong on every bar. **It is now the largest runtime-side demand
the census can see** and the natural 2F-2 candidate.

### N6 — 🔴 PRE-EXISTING RED, NOT THIS WAVE'S AND NOT FIXED HERE

`app/src/components/chart/engine/__tests__/flipCRecord.test.js` asserts
`tools/chart_parity_cases.json` has **52** cases; it has **53**. Verified
pre-existing: neither file is modified in this working tree, and
`git show HEAD:tools/chart_parity_cases.json` already counts 53.

⚰️ It is the repo's recurring defect — **a hand-typed count beside the list it
describes** — this time inside a non-vacuity guard, so the rail that exists to
prove the assertions above it are not vacuous is itself the thing that is red.
Left for the wave that owns the parity corpus: 52 → 53 is the plausible fix and
the wrong one if a case was added that should not have been.

### N7 — NEW AND CARRIED GAPS

| id | family | statement |
|---|---|---|
| **N7.1** | RUNTIME / HISTORY | `runtime:history-variable` — 7 scripts across five corpora. Per-slot ring buffer committed at end of bar. **Largest runtime-side demand.** |
| **N7.2** | RUNTIME / SERIES BRIDGE | `runtime:call-windowed-state` — 9 scripts (corrected from 13). |
| **N7.3** | TABLE / BUILTINS | `runtime:call-undeclared-builtin-state` — 2 scripts. `iff` and `cum` are not in the closed table; this is a TABLE gap surfacing through the runtime lane. |
| **N7.4** | VALUE MODEL | `runtime:call-text-state` — 1 script. Deferred by name (§22); text is a value-model change. |
| **N7.5** | VALUE MODEL | `runtime:call-conversion-state` — 1 script. `int` stays refused for the reason pine.js gives; `float`/`bool` are cheap if the lanes are moved together. |
| **N7.6** | PERSISTENCE | Still no persisted runtime artifact and no version (carried from M5.6 / L7.4). `pointwise[]` is now part of the program shape and must be in the artifact contract before anything is saved. |
| **N7.7** | RUNTIME / FRAMES | `runtime:function-global-state` (carried M5.3), default parameters (M5.4), tuple/collection ABI (M5.5) — all unchanged. |
