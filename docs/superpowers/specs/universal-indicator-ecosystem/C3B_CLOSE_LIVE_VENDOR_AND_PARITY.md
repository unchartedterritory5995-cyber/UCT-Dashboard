# C3B-CLOSE — LIVE PRODUCT + VENDOR + PARITY EVIDENCE

**The three open gate items are closed. The gate now reads 18/18 on its own
terms — and the last of those terms is deliberately narrow, so read §7 before
quoting it.**

This was an EVIDENCE wave, not an implementation wave. It nevertheless shipped
three code changes, because the evidence found three narrow defects in
capability C3B already claimed to support. Each is named below with the
measurement that exposed it; nothing was widened to make a number look better.

| # | the wave's question | answer |
|---|---|---|
| 11 | do objects actually paint on a real chart? | ✅ **9/9 fixtures, real pixels, after reopen** |
| 12 | what does TradingView actually do? | ✅ **vendor-confirmed, first object observation in the repo** |
| 13 | the fixed 10-member parity set | 🟡 **8/10 reach the chart · 5/10 paint an object · fidelity UNMEASURED** |
| 6 | does a PARAMETER move an object, and does it persist? | ✅ **765.19 → 720.19, exactly the knob delta, across a reload** |

---

## 0. THE FOUR EVIDENCE TIERS, AND WHAT EACH CLAIM BELOW HOLDS

| tier | meaning | what earns it here |
|---|---|---|
| **VENDOR_CONFIRMED** | TradingView's own model answered | object identity · update-keeps-id · delete · coordinate sourcing · table anchoring · the colour palette |
| **SPEC_CONFIRMED** | Pine's published semantics, no vendor read | — (nothing new this wave rests on spec alone) |
| **INTERNAL_ONLY** | our engine agrees with itself | the drop ledger's *reasons*; the census populations |
| **VISUAL_OBSERVATION_ONLY** | pixels exist and are ours | every live-run pixel count |
| **UNMEASURED** | not asked | **VISUAL FIDELITY of all 10 parity members** |

⛔ **The one that matters most is the last row.** Nothing in this wave measured
whether a parity-set script *looks like TradingView's rendering of the same
script*. `X/10 painted` is not `X/10 faithful`, and §5 reports the two
separately and refuses to add them.

---

## 1. ITEM 11 — REAL CHART RENDERING

`python tools/c0_visual_journey.py --base http://127.0.0.1:18772 --fixtures
tests/fixtures/c3b_live --out tools/c3b_close_live2`, on a **fresh isolated
sandbox** (`tools/_gj_launch_backend.py`, its own auth DB, port 18772, no
`--keep`, no reused browser profile — the C3A measurement problem is not
repeated).

**9 of 9 `FULL_JOURNEY_PASS`, `reopen_identical: True` on every one, and every
one painting real pixels after the reopen.**

| fixture | painted px | drawn | ids | createdBars |
|---|---|---|---|---|
| `c3b_01_line_identity` | 2,803 | line:2 | `[2, 477]` | `[60, 7998]` |
| `c3b_02_label_text` | 2,307 | label:2 | `[277, 278]` | `[7974, 7999]` |
| `c3b_03_box_zone` | 30,191 | box:2 | `[476, 477]` | `[7998, 7999]` |
| `c3b_04_table_dash` | 3,840 | table:1 | `[1]` | `[0]` |
| `c3b_05_collection` | 345 | line:104 | `1…104` | 104 distinct bars |
| `c3b_06_turnover` | 900 | line:1 | `[8000]` | `[7999]` |
| `c3b_07_param_driven` | 1,350 | line:1 | `[1]` | `[7999]` |
| `c3b_08_bar_exact` | 4,640 | line:1 | `[1]` | `[4000]` |
| `c3b_09_param_object` | 1,350 | line:1 | `[1]` | `[7999]` |

### What "painted" means here, and why the weaker readings were refused

The wave required the test to distinguish *the object program exists* from
*objects were actually painted*, and named five things not to rely on. So the
probe (`JS_OBJECT_LAYERS` in `tools/c0_visual_journey.py`) reads the layer
canvas's **own `getImageData`** and counts non-transparent pixels, carrying
three independent facts per layer:

- `selfTestPixels` — a discriminator stroke drawn and read back on the same
  canvas. **8,780 on every row**, so a zero pixel count can never be a broken
  reader; it is a renderer that drew nothing.
- `bbox` / `pane` — where the painter says it drew, so an off-screen correct
  answer is distinguishable from a failure (this is not hypothetical; see §4).
- `colours` — the actual RGB triples on the canvas, which is how the palette
  claims in §3 are cross-checked against pixels rather than against our code.

### ⚰️ The identity evidence is the id and the birth bar, not the picture

`c3b_01` reports `created: 477, updated: 21,434, deleted: 475, peakLive.line: 2`
with surviving ids `[2, 477]` born on bars `[60, 7998]`. **A final screenshot
cannot say when an object was created**, so a one-bar-early engine and a correct
one look identical in a picture. The birth bar is the engine's own record of the
bar it acted on, and `c3b_08_bar_exact` pins it to a single value: `bar_index ==
4000` → `createdBars: [4000]`.

---

## 2. ITEM 6 — DOES A PARAMETER MOVE AN OBJECT?

`python tools/c3b_param_probe.py --base http://127.0.0.1:18772 --fixture
tests/fixtures/c3b_live/c3b_09_param_object.pine --out tools/c3b_close_param9c
--input-key off --to 50`

```
declared_inputs      ["color", "lineWidth", "off"]
chips_before         c3b_09_param 741.77          pixels_before  [1350]
                     -- patch inputs.off 5 -> 50 through /api/auth/preferences, reload --
input_after_reload   [50]
chips_after          c3b_09_param 696.77          pixels_after   [1800]
y_before             765.19
y_after              720.19
result               OBJECT_MOVED
```

`765.19 − 720.19 = 45.00`, exactly `50 − 5`. The plot moved with it
(741.77 → 696.77), the reading is taken after a full page reload, and the patched
input is read back off the persisted artifact — so this is the parameter, the
recompute, the object coordinate and the reopen in one measurement.

### ⚰️ THE FIRST RUN OF THIS PROBE MEASURED THE VALIDATOR, NOT THE OBJECT MODEL

The probe originally drove `len` on `c3b_07_param_driven`, whose input is
`ta.sma(close, len)` — a **window slot**. This engine deliberately folds a
window-slot input to a literal and never offers it as a member knob
(`builderInputs.inputsFromFolded`, `interpret.js::windowLiteral`), so the saved
definition declared `color` and `lineWidth` and nothing else. Writing
`inputs.len` onto the instance made `instances.js` refuse the whole instance for
naming an undeclared input — correctly, fail-closed — and the chart simply lost
the indicator: no chip, no object layer, `pixels_after: []`.

**That reads exactly like "the object did not survive a parameter change" and is
nothing of the kind.** Two changes came out of it, both in the instrument:

1. the probe now **reads the definition's declared inputs first** and returns
   `NOT_MEASURED` with the reason, rather than producing a number;
2. every reading is **scoped to this run's own instance id**. A previous run's
   revived instance stays on the chart by design, and unscoped the probe read a
   *stale* layer's y-coordinate — reporting `object_moved: false` at 808.6995
   while the layer that belonged to the run had moved 741.77 → 696.77. A
   contaminated reading that says "no movement" is worse than no reading.

### ⚰️ AND THEN IT FOUND TWO REAL DEFECTS

**(a) The object lane was calling `interpret` wrong.** Signature:
`interpret(ast, bars, inputs, budget, scalars, opts)`. `objectColumns.js` called

```js
interpret(tree, bars, opts.interpretOpts || {})
```

putting an **empty object in the `inputs` position**, and passing no budget and
no timeframe at all. `interpret` seeds its scope from `inputs` **by name**, so a
definition that declares a member input and reads it in an object's coordinate
resolved that name to nothing and the whole column refused — while the plot
beside it, going through `nativeRegistry.computeFor`'s `resolveInputs(def,
inputs)`, honoured the same knob. One document, two evaluators, one of them deaf.
Fixed by threading the instance's inputs (through the plot lane's own
`resolveInputs`, now exported rather than copied), the document's budget, and
`ctx.tf` — `objectColumns.js`, `binder.js`, `nativeRegistry.js`.

**(b) The object pass ignored `declareInputs`.** `translatePine`'s output loop
sets `resolver.declareInputs` / `resolver.inputValues`; the factory that builds
the object pass's resolver did not. Measured on one call with
`{ declareInputs: 'all' }`: the plot formula came back
`close * (1 + off / 100)` and the object's y-coordinate came back
`close * (1 + 5 / 100)`. **Same document, same expression, the knob welded shut
on one side only.** Fixed in `pine.js` at the object-pass factory; opt-in and off
by default, so every saved document's object trees are byte-identical.

⛔ **Neither was visible to any existing rail.** Every object unit test builds
its trees out of literals, where `{}` is the correct inputs map; and the eight
original live fixtures carry no member input at all, because their only
`input.int` sits in a window slot. Seeing it needed a script whose knob sits in
an ARITHMETIC position — which is what `c3b_09_param_object.pine` is, and what
`app/src/components/chart/engine/__tests__/objectParams.test.js` now pins, with a
mutation control asserting that an empty inputs map still makes the referenced
node FAIL (so the fix cannot be quietly reverted).

---

## 3. ITEM 12 — WHAT TRADINGVIEW ACTUALLY DOES

**`tests/fixtures/vendor/visual/object-semantics-spy-1d-2026-09-08.json`** —
the repo's first vendor observation of OBJECT semantics. SPY · 1D · NYSE Arca ·
`listed_exchange` AMEX · `America/New_York`, chart model holding 300 bars,
`bar_index` at the last bar = 8457, taken 2026-09-08 on the owner-authenticated
session at `chart/VEeQHWPh`. The rail is
`app/src/components/chart/builder/vendorObjectParity.test.js` (14 cases).

**No owner action was required.** Browser automation set up the script, added it
to the chart, read the model, and removed the study again; the chart's
data-source list was verified back to its pre-capture state and **the layout was
not saved**.

### How it was read — and why this is a model read, not a screenshot

A Pine study's drawings live on its data source as
`graphics().dwglines() / dwglabels() / dwgboxes() / dwgtables() / dwgtablecells()`,
each a `Map(name → Map(flag → primitive collection))` whose `_primitivesDataById`
holds the records verbatim. Colours on those records are **palette indices**, and
the study's own `properties().state().palettes.palette_common` resolves them — so
every hex below is TradingView's answer, not an eyedropper.

### The probe, and what each section discriminates

```pine
var line anchor = na
if na(anchor)
    anchor := line.new(bar_index, close, bar_index, close, color = color.yellow, width = 3)
line.set_xy1(anchor, bar_index - 20, close)      // IDENTITY UNDER UPDATE
line.set_xy2(anchor, bar_index, close)
var line churn = na
if not na(churn)
    line.delete(churn)                            // DELETE + TURNOVER
churn := line.new(bar_index - 5, high, bar_index, high, color = color.red, width = 1)
if bar_index >= last_bar_index - 2
    label.new(bar_index, low, text = str.tostring(bar_index), …)   // A SECOND FAMILY
if barstate.islast
    box.new(…) × 4                                // MULTIPLE SIMULTANEOUS
var table t = table.new(position.top_right, 2, 2, border_width = 1)
… table.cell × 4                                  // TABLE STATE
```

### VENDOR_CONFIRMED findings

| finding | the vendor's own numbers |
|---|---|
| **identity is ONE monotonic counter shared by every family** | bar 0 mints `anchor = 1`, `churn = 2`, `table = 3` in script order; later objects continue the same sequence regardless of family — labels 8459/8461/8463, boxes 8464–8467, cells 8468–8471. There is no per-family id space. |
| **an UPDATED object keeps its id** | `anchor` was `set_xy`-moved on every one of ~8,458 bars and is **still id 1**. The churn line, rebuilt every bar, is **8462**. A re-creating engine cannot show a small id; an updating one cannot show a large one. The pair is the discrimination. |
| **delete really removes** | ~8,458 churn lines created, exactly **one** alive; `dwglines` holds 2 entries. |
| **a coordinate is read from the bar the object was CREATED on** | four boxes span x-positions up to forty bars back and every one uses the LAST bar's high/low: `y1 = 776.87…773.87 = high(299) + 4…1`, `y2 = 765.00…768.00 = low(299) − 4…1`. |
| **x is a position into a per-study index table** | a primitive stores x as an index into the study's own `_indexes` — here `[259,264,269,274,279,284,289,294,297,298,299]`, exactly the eleven model bars some object touches — not an absolute bar index and not a timestamp. |
| **`bar_index` is absolute over loaded history, not the window** | the model held 300 bars while the label text (`str.tostring(bar_index)`) reads 8455/8456/8457. |
| **a table is pane-anchored and carries no coordinates** | `{pos: "top_right", rows: 2, cols: 2, brdw: 1}` — no x, no y, unlike every other family. |
| **a cell references its table by id** | every cell carries `tid: 3` plus `col`/`row`; cells do not nest inside the table record. |

### The colour palette — eight for eight against our table

| palette index | vendor hex | Pine name | `pine.js` |
|---|---|---|---|
| 0 | `#FFEB3B` | `color.yellow` | `#FFEB3B` ✅ |
| 1 | `#FF5252` | `color.red` | `#FF5252` ✅ |
| 2 | `#2962ff` | `color.blue` | `#2962FF` ✅ |
| 3 | `#363A45` | the DEFAULT label/box text colour, which Pine spells `color.black` | `#363A45` ✅ |
| 4 | `#4CAF50` | `color.green` | `#4CAF50` ✅ |
| 5 | `#FFFFFF` | `color.white` | `#FFFFFF` ✅ |
| 6 | `#FF9800` | `color.orange` | `#FF9800` ✅ |
| 7 | `#00BCD4` | `color.aqua` | `#00BCD4` ✅ |

⭐ Index 1 **independently re-confirms the C3A-CLOSE correction** `#F23645 →
`#FF5252`, from a different surface (an object's colour rather than a marker's)
in a different capture. Index 3 is new information: the vendor's default text
colour for a label AND a box is `color.black`'s hex.

### Our engine on the vendor's own script

Running the vendor's script through our translator and runtime over 300 bars:

```
anchor  id 1   bar 0     x1 279  x2 299   y1 = y2 = close(299)   #FFEB3B  width 3
table   id 3   bar 0     position top_right, 2×2, border_width 1
churn   id 302 bar 299   x1 294  x2 299   y = high               #FF5252  width 1
boxes   ids 303-306      spans [259,264] [269,274] [279,284] [289,294]   #4CAF50
stats   created 306 · updated 604 · deleted 299 · peakLive.line 2 · writesToDeleted 0
```

The anchor's id, the table's id, the 20-bar span ending on the last bar, the four
box spans, the high/low sourcing rule, the shared counter, the "exactly two lines
alive" and the three colours **all match the vendor exactly**.

### ⚰️ The one divergence, and it is NOT the object model

The vendor draws three labels; we draw none. `objectDiagnostics` says
`droppedOps: 1`, `dropReasons: {"guard:create": 1}`, `loopBlocked: 0`,
`unsupported: []`. The label's guard is `bar_index >= last_bar_index - 2`, and
**`last_bar_index` is a name this engine does not hold** — it is in
`PINE_KNOWN_BUILTINS` so the refusal is named rather than "undefined", but there
is no column behind it. The create op is present, its family is right, and the
same guarded-create shape works wherever `barstate.islast` is used
(`c3b_02_label_text` draws two labels on a real chart). **PRE-C3B VALUE-LANE
GAP, not an OBJECT-MODEL gap** — recording it the other way would send the fix to
the wrong file.

### ⚰️ And a second finding the capture handed us for free

**A script that only draws does not translate at all.** The vendor's probe has no
`plot()`, and this engine is built on columns: a document with no output has
nothing to register. The parity rail adds one `plot(close)` line and says so.
An object-only indicator is an ordinary TradingView shape, so this is a real
compatibility gap — registered in §6, not fixed here.

---

## 4. THE RENDERING DEFECTS THIS WAVE FOUND

Four were found by the first live run and are recorded in `C3B_OBJECT_MODEL.md`
(V1 documents read as unbound; ISO-string daily times becoming NaN; `Math.min`
on string times; tables laid out but never drawn). C3B-CLOSE proper added the two
in §2 plus one measurement trap worth keeping:

⚠️ **A CORRECT DRAWING OFF THE TOP OF THE PANE READS EXACTLY LIKE A FAILURE.**
The first `c3b_09` draft used `close * (1 + off/100)` and reported `drawn:
line:1`, `bbox.y0: -16`, `pixels: 0`. The renderer was right and the object was
16 px above the pane. The fixture now uses `close - off` so both knob positions
land inside the candles, and the comment in the fixture says why. Without the
`bbox` field beside the pixel count, this would have been logged as a renderer
failure.

---

## 5. ITEM 13 — THE FIXED 10-MEMBER PARITY SET

`python tools/c0_visual_journey.py --base http://127.0.0.1:18772 --fixtures
tests/fixtures/oos2_parity --out tools/c3b_close_parity`, fresh sandbox,
instances swept clean first, no `--keep`.

⛔ **TWO INDEPENDENT COLUMNS. They are not added and neither implies the other.**

| # | script | CHART_DRAW_AND_REOPEN | objects painted | VISUAL_FIDELITY | classification |
|---|---|---|---|---|---|
| 1 | `high_engagement__10-rsi-divergence-faytterro` | ✅ `FULL_JOURNEY_PASS`, reopen ✅ | ⛔ no object layer | **UNMEASURED** | **C3B LOOP-BOUNDARY** — 6 creates dropped, `loopBlocked: 6`; RISK-043 stands |
| 2 | `high_engagement__13-ultimate-opening-range-breakout-luxalgo` | 🟡 `CHART_PARTIAL`, reopen ✅ | ✅ table, 280 px | **UNMEASURED** | **PRE-C3B TRANSLATION BLOCKED** for the plot (`pine:function`, `empty_plots: ['value']`); the object half still drew |
| 3 | `high_engagement__16-klinger-volume-oscillator-everget` | ⛔ `IMPORT_BLOCKED` | — | **UNMEASURED** | **PRE-C3B TRANSLATION BLOCKED** (`pine:state`) — and it demands **no objects at all** |
| 4 | `high_engagement__24-coppock-curve-multi-filter-markittick` | ✅ `FULL_JOURNEY_PASS`, reopen ✅, 6 plots | ✅ table, 3,709 px | **UNMEASURED** | partial objects — 25 ops kept, 42 dropped (`cell:address` 14, `guard:create` 12, `update:props` 10) |
| 5 | `long_tail__05-master-line-plus` | ⛔ `IMPORT_BLOCKED` | — | **UNMEASURED** | **PRE-C3B TRANSLATION BLOCKED** (`pine:function`) |
| 6 | `long_tail__16-spy-position-helper` | ✅ `FULL_JOURNEY_PASS`, reopen ✅ | ✅ table, 4,087 px | **UNMEASURED** | partial objects — 9 ops kept, 8 `cell:text` dropped |
| 7 | `mid_engagement__01-zeiierman-trend-pressure` | ✅ `FULL_JOURNEY_PASS`, reopen ✅, 2 plots | ⛔ no object layer | **UNMEASURED** | mixed: plots `pine:type`/`pine:function-def`/`pine:builtin`; the single box create dropped (`create:box`) — **C3B OBJECT** |
| 8 | `mid_engagement__05-supertrend-fibonacci-ote` | ✅ `FULL_JOURNEY_PASS`, reopen ✅ | 🟡 layer exists, **0 objects** | **UNMEASURED** | **C3B OBJECT** — 11 ops survive but all 24 value refs are unresolved downstream of a `pine:tuple` refusal (`guard:update` 17, `guard:delete` 6) |
| 9 | `mid_engagement__09-relative-volume-breakout-context` | ✅ `FULL_JOURNEY_PASS`, reopen ✅ | ✅ table, 12,672 px | **UNMEASURED** | partial objects — 10 ops kept, 8 `cell:text` dropped |
| 10 | `mid_engagement__22-rsi-levels-regime-map` | ✅ `FULL_JOURNEY_PASS`, reopen ✅, 12 plots | ✅ 2 tables, 2,000 px | **UNMEASURED** | partial objects — 20 ops kept, 18 dropped, `loopBlocked: 5` |

```
CHART_DRAW_AND_REOPEN     8/10 reached the chart and reopened identically
                          (7 FULL_JOURNEY_PASS + 1 CHART_PARTIAL); 2 IMPORT_BLOCKED
OBJECTS PAINTED           5/10
VISUAL_FIDELITY           0/10 measured — UNMEASURED for all ten
```

⛔ **AND THE FIVE THAT PAINTED ALL PAINTED TABLES.** Not one line, label or box
was drawn by any parity-set member. The families that carry a chart's *geometry*
are exactly the ones this set does not reach — for three separate reasons (loop
boundary, a `pine:tuple` refusal upstream of every guard, and a dropped
`create:box`). **`5/10 painted` is a true sentence about tables and would be a
false one about drawings**, which is why the "objects painted" column above is
annotated per row rather than totalled alone.

⛔ **Reachable-27 and all-46 reclassification is NOT re-derived here.** The
parity set is 10 named scripts; generalising its 5/10 to either population would
be exactly the arithmetic this programme keeps being corrected for. The census
(`tools/c3b_out/census.json`) remains the authority on the populations, and
**18/27 translate to an object program** is unchanged by this wave — no
translator capability was added.

---

## 6. GAP REGISTER ENTRIES OPENED BY THIS WAVE

| id | lane | statement |
|---|---|---|
| **H7** | **VALUE / EXPRESSION GRAMMAR** | **`%` (modulo) is not in the expression grammar.** Classified per the wave's instruction as a VALUE-LANE / EXPRESSION-GRAMMAR gap, **not an object-model gap** — an object whose coordinate uses `%` fails for the same reason a plot using `%` fails. Not implemented during C3B-CLOSE. |
| **H8** | **VALUE / BUILTINS** | **`last_bar_index` has no column.** In `PINE_KNOWN_BUILTINS` (so the refusal is named, not "undefined"), but nothing resolves it, so any guard using it drops its op fail-closed. Surfaced by the vendor capture, where it is the sole cause of 3 vendor labels versus 0 of ours. |
| **H9** | **DOCUMENT SHAPE** | **A script that only draws does not translate.** No `plot()` ⇒ no output ⇒ nothing to register. Object-only indicators are an ordinary TradingView shape; this engine cannot hold one today. |
| **H10** | **OBJECT** | **A dropped `create` in a guarded block is silent to the member.** The drop ledger records the reason (`guard:create`, `cell:text`, `update:props`, `cell:address`, `delete:target`) and the parity set shows real scripts losing 8–42 ops each, but nothing surfaces those counts in the Builder. The information exists; the door does not. |

⚠️ H10 is the one that will matter first in front of a member: today a script can
import, save, reopen and draw a table while quietly losing every line it asked
for, and the product says nothing.

---

## 7. THE EXIT GATE, RE-READ

| # | condition | result |
|---|---|---|
| 1–10 | model · identity · CRUD · bar-correctness · var refs · collections · envelopes · GC · graph compactness · persistence | ✅ unchanged from C3B |
| **11** | **real chart rendering proven** | ✅ **9/9 fixtures, real pixels, after reopen, fresh sandbox** |
| **12** | **TradingView object evidence** | ✅ **VENDOR_CONFIRMED: identity, update, delete, a second family, four simultaneous objects, table state, and the palette** |
| **13** | **fixed 10-member parity set remeasured** | 🟡 **re-run and reported — 8/10 draw+reopen, 5/10 paint (all tables), fidelity UNMEASURED** |
| 14 | reachable OOS fidelity improves materially | 🟡 **18/27 unchanged.** No translator capability was added; the three fixes are wiring, not grammar |
| 15 | RISK-043 intact | ✅ not weakened; parity member 1 is loop-blocked and reported as such |
| 16 | no silent object loss called FULL | ✅ every drop carries a reason; §5 reports them per script |
| 17 | performance acceptable | 🟡 accepted **provisionally**, per the wave — not a production-readiness claim |
| 18 | no regression | ✅ see §8 |

**GATE: 18/18 conditions have an answer. Two of them (13, 14) are answers the
programme should not be pleased with**, and one (17) is provisional by
instruction. The architecture stands; the compatibility surface is where the work
is.

---

## 8. FULL-SUITE ACCOUNTING

`npx vitest run src/components/chart` from `app/`:

```
  Test Files   6 failed | 348 passed (354)
  Tests        7 failed | 7,602 passed | 4 skipped (7,613)
```

**Added this wave:** `objectParams.test.js` (4) + `vendorObjectParity.test.js`
(14) = **18 new cases, all green.**

⛔ **ZERO of the seven failures is attributable to this wave, and that is
measured rather than asserted.**

**Four failures in three files are LOAD-TIMEOUT FLAKES.** Each is a whole-`app/src`
AST walk that exceeds the 15 s `testTimeout` when the suite runs 354 files
concurrently. Run together and alone: **71/71 green in 8.2 s**, against 41.4 s +
53.4 s + 20.9 s for the same three files inside the full run.

| file | in the full run | alone |
|---|---|---|
| `EvidenceTab.doors.test.js` | 1 failed, 41,452 ms | ✅ |
| `engineEnabledMigration.test.js` | 2 failed, 53,425 ms | ✅ |
| `enumerationSites.test.js` | 1 failed, 20,897 ms | ✅ |

**Three failures in three files are PRE-EXISTING AT `HEAD` (`b7e5c28cb`).** Proven
the same way each time: **snapshot every modified source file's BYTES, write
`HEAD`'s bytes over all eight, re-run, restore, and verify each restoration
sha256-identical** — never a `git checkout`, which has silently discarded
uncommitted work in this repo before.

| file | failure | why it is not ours |
|---|---|---|
| `flipCRecord.test.js` | `expect(cases).toHaveLength(52)` while `tools/chart_parity_cases.json` holds **53** | that JSON and that test are both unmodified in this tree, and `git show HEAD:tools/chart_parity_cases.json` also holds 53. **A hand-typed count beside the list it describes** — this repo's recurring defect. Left for its owner rather than silently retyped. |
| `ImportBox.thinkscript.test.jsx` | a trailing-whitespace difference in the paste field after a declined suggestion | still red with all eight source files reverted to `HEAD` |
| `BuilderSheet.pine.test.jsx` | `sent` undefined — the save POST never fires in *"the SAVED DOCUMENT is byte-identical to the same formula typed by hand"* | still red with all eight source files reverted to `HEAD` |

Everything else green.

---

## 9. WHAT I RECOMMEND NEXT — AND WHAT I DID NOT DO

**Not done, deliberately**, because the wave forbade it: no `bgcolor`,
`barcolor`, `plotcandle`, `plotbar`; no generalized loops; no new Pine semantics;
no new input types; no numeric screener support; no Builder authoring UI; no
`%`; no direct object-authoring UI; `vendor_truth.py` H6 untouched.

**The recommendation is a COMPATIBILITY wave, not another object wave.** The
object model is not what is holding the parity set back — the evidence says so
three different ways:

1. two of ten never reach the engine at all (`pine:function`, `pine:state`);
2. of those that do, the geometry families are lost to a `pine:tuple` refusal
   upstream of every guard, one dropped `create:box`, and the loop boundary;
3. the vendor comparison on a script the model handles *perfectly* diverged on
   exactly one thing, and it was a missing VALUE-lane builtin.

So the next wave that moves the governing objective is the one that widens the
**expression and statement grammar** (tuples, user functions, `%`,
`last_bar_index`, the `pine:state` family), plus **H10** — telling a member what
their script lost. A second object wave would polish a lane that is already
ahead of the one feeding it.

**STOP. Do not begin the next wave.**
