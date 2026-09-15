# Item (j) — Uncharted Clouds as a hosted member pane: SCOPING READ

**A MEASUREMENT, NOT A PLAN.** No estimate, no proposed design, no implementation
sketch. Every claim below carries `file:line` and a quoted line. A claim that could
not be reached by reading is in §"WHAT I COULD NOT ESTABLISH BY READING" and is a
finding, not a softened assertion.

Worktree: `C:\Users\Patrick\uct-worktrees\indicator-r0r1`. Read-only except this file.

---

## 0. THE FIXTURE, COUNTED FIRST

`tests/fixtures/member/uncharted-clouds.pine` — 169 lines.

| thing | count | lines |
|---|---|---|
| `plot(` calls | **23** | 50, 51, then 64–84 |
| `display=display.none` | **21** | 64–84 |
| `fill(` calls | **20** | 118–137 |

The two visible plots are `tests/fixtures/member/uncharted-clouds.pine:50-51`:

```
plot(showMA1 ? fastMA : na, "Fast MA", color=ma1Color, linewidth=2)
plot(showMA2 ? slowMA : na, "Slow MA", color=ma2Color, linewidth=2)
```

The 21 anchors are `…:64-84`, e.g. `:64`:

```
p1 = plot(array.get(layerArray, 0), display=display.none, editable=false)
```

The 20 fills are a CHAIN, `…:118-137`, e.g. `:118`:

```
fill(p1, p2, color=isBullish ? getBullFillColor(0) : getBearFillColor(0))
```

**23 is corroborated in the suite**, not only by my own count —
`app/src/components/chart/engine/ast/vectorUnroll.test.js:61`:

```
expect(withMa.length, 'two MA plots plus twenty-one layers').toBe(23)
```

and the chain is 20 distinct `from` handles (p1…p20), which matters for G9 below.

---

## 1. THE NUMBERED GAP LIST

Layer column: **ENGINE** = `ast/pine.js` and friends · **CARRIAGE** = the
definition document between engine and renderer · **RENDERER** = `binder.js`,
`pool.js`, `fillPrimitive.js`.

| # | gap | where it lives | layer |
|---|---|---|---|
| **G1** | The 21 `display.none` anchors are filtered out of the pane document. `!o.hidden` | `app/src/components/chart/builder/memberPane/memberPaneDefinition.js:100` | CARRIAGE |
| **G2** | A SECOND, INDEPENDENT ceiling: `CARRY_MAX = 12` caps the row set at 12. It does not bite today (2 ≤ 12) and would bite at 23. | `memberPaneDefinition.js:50`, applied at `:102` | CARRIAGE |
| **G3** | `translation.presentation.fills` is never read by the pane document builder. The word `fill` occurs in that file exactly once, in a COMMENT. `buildDefinition` already accepts the field; the pane path does not pass it. | `memberPaneDefinition.js:91` (the only occurrence); `memberPaneDefinition.js:164-205` (the `buildDefinition` call, no `fill`); contrast `BuilderSheet.jsx:2263-2271` which DOES populate it | CARRIAGE |
| **G4** | A hidden plot is ORPHANED in the binder's pass one, before the fill wiring in pass two ever sees it. A fill declared on a hidden row therefore cannot draw. | `app/src/components/chart/engine/binder.js:824` (the skip) vs `:931` + `:1000-1032` (the fill wiring, pass two) | RENDERER |
| **G5** | The fill primitive takes ONE static colour for the whole band. `ctx.fillStyle` is set once, outside the polygon loop. There is no per-bar colour path. | `app/src/components/chart/engine/fillPrimitive.js:148`, `:169`; fed by `binder.js:1022` → `binder.js:76-82` | RENDERER |
| **G6** | The fill COLLECTOR computes the full presentation and forwards only two fields. `colorUp` / `colorDown` / `colorCondition` / `colorDynamic` / `colorDynamicArity` exist for plots and are discarded for fills. | `app/src/components/chart/engine/ast/pine.js:11287-11293`; `pine.js:12469-12484` (`resolveFillHandles`) | ENGINE |
| **G7** | Even the discarded half would be EMPTY for Clouds. `colourConditional` needs `staticColourOf` on BOTH ternary branches; Clouds' branches are user-function calls, so it returns `null` and only `pres.colorDynamic = true` survives. | `pine.js:12416-12456`; `pine.js:12549` | ENGINE |
| **G8** | `defSchema` has no per-bar fill colour. `plots[].fill` is `{with}` only; `fillColor`/`fillOpacity` are plain static values. Plots have `colorMode: 'column:<key>'` + `colorUp`/`colorDown`; fills have NO analogue. | `app/src/components/chart/engine/defSchema.js:1580-1584`; `defSchema.js:1782-1808`; contrast `BuilderSheet.jsx:470-473` | CARRIAGE (schema) |
| **G9** | ONE fill per plot row. `fill: {with}` is singular and the binder reads `b.plot.fill` singular. Clouds' 20 fills are a CHAIN with 20 distinct `from` rows, so the arity is compatible TODAY — recorded because it is a ceiling and because the builder's importer silently drops a second fill on the same `from`. | `defSchema.js:1580`; `binder.js:1012`; `BuilderSheet.jsx:2266` (`\|\| fillPatches.has(from)) continue`) | CARRIAGE |
| **G10** | `zorder.js` is a map NOBODY CONSUMES — its sole importer is its own test — and it disagrees with the shipped primitive about where a fill paints. | `app/src/components/chart/engine/zorder.js:79` (`slot: 'normal', subpass: 'drawBackground', physical: 1`) vs `fillPrimitive.js:156-157` (`zOrder: () => 'bottom'`, plain `draw`). Importers: `engine/__tests__/zorder.test.js:30` and nothing else | RENDERER |
| **G11** | No rail exercises Clouds through the pane document builder. `memberPaneDefinition.test.js` contains zero occurrences of `clouds`, `hidden` or `fill` (grep -i, 0 hits). The 2-of-23 fact is asserted nowhere in the suite. | `app/src/components/chart/builder/memberPane/memberPaneDefinition.test.js` | RAIL |

### ⭐ GAPS THAT ARE THE SAME GAP — and the pair that is NOT

- **G1 + G4 are ONE SYMPTOM ACROSS TWO INDEPENDENT DROPS.** They are not the same
  gap and must not be collapsed into one. The 21 anchors are dropped TWICE, by two
  files that do not know about each other: once at `memberPaneDefinition.js:100`
  (they never enter the document) and once at `binder.js:824` (a hidden plot that
  DID enter the document is orphaned before pass two). **Lifting G1 alone produces
  no cloud** — the rows would reach the binder and be orphaned there. The task asked
  whether (1) and (4) are the same gap: they share an observable and nothing else.
- **G3 + G8 are a linked pair, one behind the other.** The fill has nowhere to land
  on the pane document (G3); and the landing site, when reached, cannot express a
  conditional colour (G8).
- **G6 + G7 are a linked pair.** G6 is a carriage loss at the push; G7 says the thing
  lost is empty for Clouds anyway. Fixing G6 alone changes nothing for Clouds.
- **G2 is genuinely separate** from G1 despite sitting four lines away: a different
  constant, a different reason (`memberPaneDefinition.js:48-49`: *"A script with
  forty plots is not a reason to register forty columns on somebody's chart"*).

---

## 2. ANSWER (1) — THE SAVED DEFINITION, AND THE STEP THAT DROPS 21

### What a hosted pane reads

`app/src/components/chart/engine/ast/paneGate.js:44`:

```js
export const PANE_LANE = 'host'
```

and `paneGate.js:3-8`:

```
// ─── ⭐⭐ RULING D2 (option B) — WHAT A PANE IS ALLOWED TO DRAW ──────────────
//
// T3/T5 drive a member pane from the SAVED DEFINITION the HOST lane produces.
```

The producer of that saved definition is `memberPaneDefinition.js:9-11`, which
states the whole walk:

```
//     source → translatePine(strict) → paneGate → rows → buildDefinition
//              → installUserDefinitions → addInstance → binder → columns
```

### Does one exist for Clouds?

**NO** — measured by a previous session and recorded at
`docs/pine/WAVE2-A-PLAN.md:2020`:

```
| 3 | a **Clouds** definition exists to photograph | ⛔ **NO.** Both rig definitions
have 4 plots — that is Uncharted **Volume v2**, Wave 1's target. Clouds has 23 outputs |
```

### THE STEP THAT DROPS 21 — named, with the line

**`app/src/components/chart/builder/memberPane/memberPaneDefinition.js:99-102`:**

```js
  const drawable = (t.outputs || [])
    .filter((o) => o && o.ast && o.formula && !o.hidden && !o.refusal
      && o.kind !== 'alertcondition')
    .slice(0, CARRY_MAX)
```

**`!o.hidden` on line 100 is the drop.** It is deliberate and documented three lines
above it, `memberPaneDefinition.js:89-92`:

```
  // ⛔ THE ROWS ARE THE ONES A CHART CAN DRAW, and `hidden` is respected because
  // an author who wrote `display = display.none` meant it — Clouds' layer plots
  // exist only as `fill` anchors. A pane that drew them would be drawing the
  // scaffolding.
```

### The full trace, concretely

1. **translate.** `translatePine(CLOUDS, {strict: true})` → `outputs` of length **23**,
   `refusals` length **0**. Outputs: `vectorUnroll.test.js:61`. Refusals:
   `fillColourCarriage.test.js:103` (`expect((t.refusals || []).length).toBe(0)`) and
   `:110-111` for both lanes.
2. **the `hidden` flag is set in the engine**, at `pine.js:11566`:
   ```js
   hidden: authorHid || flat || fillAnchor,
   ```
   with the reason recorded beside it, `pine.js:11578`:
   ```js
   hiddenReason: authorHid ? 'author' : fillAnchor ? 'fill-anchor' : flat ? 'constant' : null,
   ```
   `authorHid` comes from `outputHidden` (`pine.js:12856-12861`), which reads
   `display = display.none` (`pine.js:12861`: `return !!(d && d.value && d.value.type
   === 'name' && d.value.name === 'display.none')`). Clouds' 21 are `authorHid`.
   **A hidden output is NOT a strict-mode failure** — `pine.js:11928-11933`:
   ```
   // ⭐ A HIDDEN OUTPUT IS NOT A FAILURE and strict mode does not treat it as one.
   // `display = display.none` is an author's choice — Clouds' layer plots are
   // hidden ON PURPOSE, they exist only as `fill` anchors
   ```
   So all 23 survive translation with `ok: true`.
3. **paneGate passes.** `paneGate.js:51-76` checks lane, `ok`, `selected`, and only
   `outputs[t.selected]` (`:71-74`). It does not filter the row set. Clouds passes.
4. **the drop.** `memberPaneDefinition.js:100` removes the 21. `23 → 2`.
   `CARRY_MAX = 12` (`:50`) does not bite because 2 < 12.
5. **the rows built.** `memberPaneDefinition.js:118-150` builds 2 rows and carries
   `style`, `color`, `opacity`, `marker` (`:136-148`). **It carries no `fill`.**
6. **the document.** `buildDefinition({… plots: rows …})` at
   `memberPaneDefinition.js:164-205`. No `fills` argument is passed, and
   `buildDefinition` only emits `plots[i].fill` from `r.fill` on a ROW
   (`BuilderSheet.jsx:486-493`) — a field these rows never set.
7. **what the renderer receives.** 2 line plots, no fill, no anchors.

### The surviving 2, and why they survive

`Fast MA` and `Slow MA` — fixture lines 50 and 51 — the only two plots with no
`display=display.none`, hence the only two with `hidden !== true`. Confirmed
independently at `docs/pine/WAVE2-A-PLAN.md:2029-2031`:

```
2. With the **host** lane it builds `ok: true` — and yields **2 plots, not 23**:
   `Fast MA` and `Slow MA`. The 21 layers are `hidden: 'author'` (`display=display.none`)
   and the pane filters hidden outputs out.
```

and the consequence at `WAVE2-A-PLAN.md:2033-2035`:

```
⛔ **SO A PIXEL COMPARISON TODAY WOULD MEASURE ITEM (j)'s GAP, NOT a6's CORRECTNESS.**
The vendor draws 2 MAs plus 20 translucent cloud fills; the hosted pane would draw 2 MAs
and no clouds, because the fills are chart-only notes and the layers are author-hidden.
```

⚠️ **One phrase in that last quote is now imprecise and I flag it rather than
repeat it:** "the fills are chart-only notes". The fills ARE still chart-only notes
(`pine.js:11296`) **and** they are additionally carried as `presentation.fills`
since a6/R10 — `fillColourCarriage.test.js:93` asserts `fills.length` is **20** with
edges resolved. The fills are not lost in the ENGINE. They are lost in the
CARRIAGE, at G3.

**This trace does not go cold.** Every step is a line I read.

---

## 3. ANSWER (2) — THE RENDERER, PER OUTPUT KIND

The pane renderer is `binder.js` over a `defSchema` document, with series types
chosen by `pool.js`.

### Kinds it handles

| declared style | what is drawn | file:line |
|---|---|---|
| `line` | LWC `LineSeries` | `pool.js:104`, `:108`; ctor `binder.js:85-90` |
| `stepline` | `LineSeries` with `lineType = WithSteps` | `pool.js:105`, `:108`; the option at `pool.js:565` — `base.lineType = lineTypeValue(plot.style === 'stepline' ? 'WithSteps' : 'Simple', c.LineType)` |
| `band` | **falls through to `LineSeries`** — no distinct band renderer | `pool.js:106-108` |
| `markers` | `LineSeries` + a marker layer via injected `ctx.createSeriesMarkers` | `pool.js:107-108`; `binder.js:1050-1071` |
| `histogram` | `HistogramSeries` | `pool.js:109-110` |
| `area` | `AreaSeries` | `pool.js:111-112` |
| `baseline` | `BaselineSeries` | `pool.js:113-114` |
| `hlines` | NOT a series — `series.createPriceLine` guides | `pool.js:681`; `binder.js:993-994` |
| anything else | `null` → nothing is drawn | `pool.js:115-116` |
| `hidden: true` (any style) | column computed, **no series** | `binder.js:821-824` |
| per-point colour | `colorMode: 'sign'` and `colorMode: 'column:<key>'` | `binder.js:113` (`toPoints`), `:781-799` (`pointsFor`) |
| objects/tables | `definition.objects` → object layer | `memberPaneDefinition.js:204` |

`PLOT_STYLES` is closed at 8 members, `defSchema.js:156-158`:

```js
export const PLOT_STYLES = Object.freeze([
  'line', 'stepline', 'histogram', 'area', 'baseline', 'hlines', 'markers', 'band',
])
```

### Does a FILL BETWEEN TWO PLOTS exist at all?

**YES.** `app/src/components/chart/engine/fillPrimitive.js` is a complete, unit-tested
plot↔plot band (C1-B). Its own header states the demand it was built against,
`fillPrimitive.js:5-8`:

```
// `fill(plotA, plotB, color)` is Pine's band idiom and it is not a niche one:
// measured over the frozen 60-script out-of-sample corpus, **35 fill() calls
// across 18 scripts, and 33 of the 35 are plot↔plot**.
```

It is wired in `binder.js:1000-1032`, created once per binding at `binder.js:1024`
(`fill = createFillPrimitive({})`) and fed at `binder.js:1027-1030`.

### What does it accept?

**A STATIC COLOUR AND A STATIC OPACITY ONLY.** `fillPrimitive.js:148`:

```js
let opts = { upper: null, lower: null, times: null, color: '#2962FF', opacity: 0.15, ...initial }
```

and the draw sets the style ONCE, outside the polygon loop — `fillPrimitive.js:169`:

```js
ctx.fillStyle = withAlpha(opts.color, opts.opacity) || opts.color
```

The colour is resolved by `binder.js:76-82`:

```js
function effectiveFillColour(plot) {
  const color = (plot && typeof plot.fillColor === 'string' && plot.fillColor)
    || (plot && typeof plot.color === 'string' && plot.color) || '#2962FF'
  const opacity = (plot && Number.isFinite(plot.fillOpacity))
    ? Math.max(0, Math.min(1, plot.fillOpacity)) : 0.15
  return { color, opacity }
}
```

**There is no per-bar colour path in the fill primitive.** A per-bar colour path
exists for PLOTS (`binder.js:113` `toPoints(column, bars, adjustTime, signColors,
colColors, condColumn)` emits a `color` per point) and has no fill analogue.

---

## 4. ANSWER (3) — THE FILL NOTE SHAPE, AND THE CONTRACT GAP

### What a fill carries today — the real field set

**`{a, b, color?, opacity?}` — and `color`/`opacity` are OPTIONAL and omitted when
absent, not `undefined`.** Two authorities, both read:

`pine.js:11288-11293` (the collector):

```js
            fills.push({
              a: a.name,
              b: b.name,
              ...(pres.color ? { color: pres.color } : {}),
              ...(Number.isFinite(pres.opacity) ? { opacity: pres.opacity } : {}),
            })
```

`pine.js:12469-12484` (`resolveFillHandles`, handles → output indices), the emitting line:

```js
    out.push({ a: ai, b: bi, ...(f.color ? { color: f.color } : {}),
      ...(Number.isFinite(f.opacity) ? { opacity: f.opacity } : {}) })
```

Published at `pine.js:11979`:

```js
    presentation: { overlay, levels, fills: resolveFillHandles(fills, outputs, resolved) },
```

The suite pins exactly this: `fillColourCarriage.test.js:60-62` (`fills[0].a` is `0`,
`fills[0].b` is `1`), `:70-71` (a dynamic colour arrives `undefined`, never guessed),
`:78` (`Object.hasOwn(fills[0], 'opacity')` is `false` for a 3-arg colour).

For Clouds: **20 fills, 0 colours**, and `fillColourCarriage.test.js:91` calls that
**CORRECT, not a gap**:

```
  it('⭐⭐ CLOUDS — 20 fills, 0 colours, and that is CORRECT, not a gap', () => {
```

### THE CONTRACT GAP — named, not designed

To draw a fill whose colour is a series-conditional per bar, the renderer would have
to receive **a per-bar colour decision for the band**, and **every layer between the
`fill()` call and `fillPrimitive.draw` currently types that value as a single
string**. The gap is a chain of four contracts, each measured:

1. **The engine discards the conditional half it already computes.**
   `pine.js:11287` calls `outputPresentation(fargs, { env })` — *the same call a
   `plot()` makes*, which is R10's "no second colour path" satisfied by construction.
   That call produces, for a conditional colour, `colorUp` (`pine.js:12525`),
   `colorDown` (`:12526`), `colorCondition {ast, formula}` (`:12527`),
   `colorDynamic` (`:12537`), plus `colorDynamicArity` and `colorNaGated`.
   **Lines 11288-11293 forward only `color` and `opacity`.**
   *The gap is:* the fill note has no field for a condition, while the plot note has
   three.
2. **For Clouds the conditional half would be empty anyway.**
   `colourConditional` (`pine.js:12416-12456`) requires `staticColourOf` to fold BOTH
   ternary branches — `pine.js:12426-12428`:
   ```js
     const up = staticColourOf(node.yes, env)
     const down = staticColourOf(node.no, env)
     if (!up || !down) {
   ```
   Clouds' branches are `getBullFillColor(0)` / `getBearFillColor(0)` — user-defined
   function CALLS, folded by neither. `staticColourArity` then returns ≤ 2, so the
   function returns `null` (`pine.js:12451`) and `outputPresentation` records only
   `pres.colorDynamic = true` (`pine.js:12537`). *The gap is:* a colour that is a
   user-function call is outside the static-colour vocabulary entirely, in both
   directions of the ternary.
3. **The document has no field to hold it.** `defSchema.js:1580-1584` validates
   `plots[].fill` as `{with: "<plotKey>"}` and nothing more; `fillColor` /
   `fillOpacity` are set as plain values at `BuilderSheet.jsx:489-490`. The PLOT side
   already has the per-bar idiom — `BuilderSheet.jsx:470-473`:
   ```js
      ...(r.colorMode && r.colorUp && r.colorDown
        ? { colorMode: r.colorMode, colorUp: r.colorUp, colorDown: r.colorDown }
        : {}),
   ```
   documented at `BuilderSheet.jsx:463-466` as *"`colorMode: 'column:<key>'` names
   ANOTHER row of this same document — the hidden one holding the condition — and
   `binder.toPoints` colours each point by whether that column is non-zero."*
   *The gap is:* fills have no such mode, and the condition column that the plot idiom
   would use is exactly the kind of hidden row G1 currently deletes.
4. **The primitive paints one colour per band.** `fillPrimitive.js:169` sets
   `ctx.fillStyle` once for every polygon of the frame. *The gap is:* the primitive's
   `draw` has no seam at which a colour could vary along the band, and `fillPolygons`
   (`fillPrimitive.js:131-135`) returns geometry only, with no per-run colour channel.

**Smallest thing that would have to change, stated as a contract and not an
implementation:** the fill note would have to be able to SAY "this band's colour is
decided per bar by <something the document also carries>", the document would have to
be able to HOLD that sentence, and the primitive would have to be able to READ it —
and Clouds additionally needs the *"something"* to survive a colour expressed as a
call to a user-defined function, which no existing colour path folds. I name the four
contracts; I do not choose between them. That is the owner's and the main session's.

---

## 5. ANSWER (4) — `display.none` ANCHORS

### Is the count 21? VERIFIED.

`grep -c 'display\.none' tests/fixtures/member/uncharted-clouds.pine` → **21**,
at lines 64–84, one per `p1`…`p21`.

### Does the renderer HONOUR `display.none`?

**The schema and the renderer honour `hidden` — meaning COMPUTED, NEVER DRAWN.**
`defSchema.js:1576-1578`:

```
  // is a boolean and nothing else: a hidden plot is COMPUTED and never drawn
  // (the binder skips it in pass one; the column still reaches the alert seam
  // and the scan)
```

`binder.js:821-824`:

```js
      // ⭐ W1b — `plots[].hidden`: COMPUTED, NEVER DRAWN. The column still reaches
      // the scan and the alert seam through `computeFor`; the chart gets no
      // series. A series this binding was carrying goes back to the renderer.
      if (b.plot && b.plot.hidden === true) { orphan(b); continue }
```

And columns for hidden plots DO exist — they are computed per INSTANCE, before any
per-plot decision, `binder.js:735-737`:

```js
      for (const plotKey of Object.keys(cols)) {
        columns.set(bindingKey(inst.instanceId, plotKey), cols[plotKey])
      }
```

`buildDefinition` even insists a hidden plot keeps its legend block,
`BuilderSheet.jsx:457-460`: *"That includes a HIDDEN one: hidden is about the CANVAS,
and its column still reaches the alert seam and the scan."*

### Can it draw a fill BETWEEN TWO HIDDEN PLOTS, as TradingView does?

**NO, and the reason is structural rather than a missing branch.**

- The binder runs in **two passes**. Pass one builds `prepared` (`binder.js:819-926`);
  pass two iterates it (`binder.js:931`) and is where the fill wiring lives
  (`binder.js:1000-1032`).
- `binder.js:824` `continue`s a hidden plot **in pass one**, so it never enters
  `prepared` and never reaches pass two at all.
- The fill primitive is attached to the OWN plot's SERIES —
  `binder.js:1025` `attempt(() => series.attachPrimitive(fill.primitive))`. A hidden
  plot has no series (`orphan` removes it, `binder.js:776`:
  `const orphan = (b) => { if (b.series) attempt(() => chart.removeSeries(b.series)) }`).

So: **a fill declared on a hidden row is silently not drawn** — it would validate,
register, and paint nothing. The COLUMNS for both edges would be present
(`binder.js:736`); the ATTACH POINT would not.

### ⭐ IS THIS THE SAME GAP AS (1)?

**No — it is the same symptom reached twice, and the distinction is load-bearing.**

- (1) is `memberPaneDefinition.js:100`: the anchors never enter the document.
- (4) is `binder.js:824`: an anchor that DID enter the document is dropped before the
  fill wiring runs.

They are in different files, different layers, and neither one's removal makes the
other irrelevant. **Lifting (1) alone yields 21 rows that the binder orphans and 0
clouds.** Reporting them as one gap would hide that.

⛔ One corollary worth stating because it is exactly the class of error this
programme has been burned by: `display.none` anchors are **NOT dropped by the
engine**. `pine.js:11928-11933` explicitly keeps them and calls them "an author's
choice", and `vectorUnroll.test.js:50-70` proves all 21 carry real, DISTINCT trees
(`expect(new Set(layers).size, 'each layer interpolates differently').toBe(21)`).
The 21 exist, fully computed, all the way to `memberPaneDefinition.js:99`.

---

## 6. ANSWER (5) — WAVE 1's TOLERANCE PROCEDURE, REPRODUCED

The procedure is `app/src/components/chart/builder/memberPane/seriesCompare.js`,
driven from the T5 capture. `(j)`'s acceptance is required to be the same —
`docs/pine/WAVE2-A-PLAN.md:2045-2046`: *"then vendor and hosted captures at Wave 1's
tolerance, both tables, the two mobile tiers."*

### The owner's ruling, verbatim — `seriesCompare.js:5-6`

```
// Owner ruling, 2026-09-12: *"integers exact, floats max rel ≤ 1e-9 with abs
// beside, per-series table."*
```

### What was compared, and how

- **Unit of comparison: one SERIES at a time**, ours vs the vendor's decoded capture,
  bar-aligned. `compareAll` at `seriesCompare.js:204-221`.
- **Float bound:** `seriesCompare.js:26` — `export const MAX_REL = 1e-9`. The relative
  error is `abs / Math.max(Math.abs(y), 1)` (`seriesCompare.js:187`) and the ABSOLUTE
  error is reported beside it, never instead (`seriesCompare.js:17-19`).
- **Integer rule — R-L, "EXACT is redefined, not loosened" (`seriesCompare.js:29-62`):**
  an integer series compares EXACTLY *after the coarser side's granularity is applied*
  (`quantise`, `seriesCompare.js:65-69`). ⛔ The unit is **declared per fixture, never
  inferred** (`seriesCompare.js:47-53`). ⛔ *"AND IT IS NOT A TOLERANCE"*
  (`seriesCompare.js:55-60`) — a bar differing by 101 shares still fails.
- **Depth gate runs BEFORE the comparison** (`seriesCompare.js:206-218`): a column
  short of its own window is **EXCLUDED with the reason on the row**, so no number
  enters the table that nobody should read.

### How a PASS is declared — `seriesCompare.js:190-200`

```js
    if (row.reason === null) {
      if (row.mismatches > 0) {
        row.reason = kind === 'int'
          ? `${row.mismatches} integer values differ`
          : `${row.mismatches} bars are blank on one side only`
      } else if (row.maxRel > MAX_REL) {
        row.reason = `max relative error ${row.maxRel.toExponential(3)} exceeds ${MAX_REL.toExponential(0)}`
      }
    }
    row.ok = row.reason === null
```

⛔ And the comparator **reports; it does not assert** (`seriesCompare.js:21-23`):
*"The verdict per series is a value the caller tests, so the same function serves the
rail and the report. A comparator that threw could not print the table the ruling
asks for."* One renderer for both (`seriesCompare.js:224-225`).

### TABLE 1 — the per-series comparison (`docs/pine/PR-BODY.md:139-145`)

```
series            kind   bars  cmp  blank  max rel   verdict
Volume            int    4     4    0      —         4 integer values differ
Avg Vol Columns   float  4     1    3      1.235e-4  max rel error exceeds 1e-9
Avg Vol Line      float  4     0    0      0.000e+0  4 bars blank on one side only
Scale Padding     float  4     0    0      0.000e+0  4 bars blank on one side only
```

(The fuller form, with the `abs there` and `worst bar` columns, is at
`docs/pine/SESSION-STATE.md:2444-2450`. The per-bar Volume evidence that produced R-L
is at `SESSION-STATE.md:2455-2460`.)

### TABLE 2 — the mobile audit, BOTH TIERS (`docs/pine/PR-BODY.md:150-160`)

Header: *"Mobile audit, both tiers, gate v2.1 read before every capture"*.
**Tiers: `phone390` and `touch1024`.**

| row | phone390 | touch1024 |
|---|---|---|
| tables drawn, both corners | PASS | PASS |
| quarter-height pane (no 29px frame) | PASS — 652px | PASS — 528px |
| disclosures readable | PASS — 3 lines, 0 with zero layout | PASS — 3 lines |
| scrub · pinch-zoom · scroll · rotate — anchored / no artefacts | PASS ×8 | PASS ×8 |
| no overlap — price scale / toolbar / joystick hub | PASS | PASS |
| tables-fit (R-R) | PASS — scaled `['0.758','0.941']`, wrap 0, note shown ×1 | PASS — `['none','none']`, no note |
| capture @100% · @125% | PASS — gate true | PASS — gate true |

The two mobile terms are DEFINED, `PR-BODY.md:163-165`:

```
"Anchored" is measured as *the table's rect is byte-identical before and
after the gesture*; "no artefacts" as *the cell TEXT is identical* — a redraw that
changed a number would pass a rect check and fail this one.
```

### The rest of the procedure, so it is re-runnable

- **A receipt binds the captured script to the fixture** — `SESSION-STATE.md:2334-2336`:
  *"the script the browser ran hashes to `518a6b22…b28a` — byte-identical to
  `tests/fixtures/member/uncharted-volume-v2.pine` and to what TradingView ran for
  the vendor capture."*
- **Gate v2.1 is read before EVERY write and screenshot**, and its binding test is
  own-text **`Add to chart` plus 0 studies** by the corrected probe, **never "editor
  closed"** — `WAVE2-A-PLAN.md:2043-2045` and `:2065-2067`.
- **Rig:** `docs/pine/wip/rig/boot_rig.py`, `UCT_RIG_DATA` pointing **outside every
  worktree** (`WAVE2-A-PLAN.md:2063-2064`).
- **Vendor fixtures are named by commit** — `PR-BODY.md:171-176`; the shallow SPY 1D
  capture `7f94f4404` is **SUPERSEDED / `WINDOW_UNMEASURED`** and kept, not deleted.
- ⚠️ **Gate v2.1 was never reached on the Clouds attempt** and therefore no gate
  counts exist for it — `WAVE2-A-PLAN.md:2048-2049`: *"Claiming one would be
  inventing a measurement."*

---

## 7. ⛔ WHAT I COULD NOT ESTABLISH BY READING

Each of these is a finding. None is completed by assumption.

1. **I did not RUN anything.** No vitest, no translate, no browser — the task forbids
   it. So "23 outputs" and "2 rows" are read from the fixture, from the filter at
   `memberPaneDefinition.js:100`, and from two independent written measurements
   (`vectorUnroll.test.js:61`; `WAVE2-A-PLAN.md:2029-2031`). **I did not observe the
   number 2 come out of the function myself.**
2. **Whether `presentation.fills` for Clouds resolves all 20 pairs to indices INSIDE
   the 23-output list in the order I assume** (p1→index 2, p21→index 22). The test
   asserts only that each `a`/`b` is an integer and `a !== b`
   (`fillColourCarriage.test.js:98-101`). The specific index mapping is unasserted
   anywhere I found, and I did not derive it.
3. **Whether `fillRuns`/`runPolygon` behave correctly on 20 stacked, adjacent bands.**
   `fillPrimitive`'s tests cover one band (`engine/__tests__/fillPrimitive.test.js`).
   Overlap, per-frame cost, and z-ordering among 20 primitives on 21 series are
   untested and unmeasured. I did not measure them.
4. **Whether `binder.js:824`'s skip has any consumer that depends on hidden plots
   having no series.** I read the one call site; I did not audit every reader of
   `prepared` for that assumption.
5. **`zorder.js`'s status.** It has exactly one importer — its own test
   (`engine/__tests__/zorder.test.js:30`). Whether that is intentional (a map awaiting
   W6) or a wiring gap is not stated in any line I read. `fillPrimitive.js:156` picks
   `'bottom'` with its own reasoning (*"BELOW THE LINES IT SITS BETWEEN"*), which is a
   different answer from `zorder.js:79` (`'normal'` + `drawBackground`). **I could not
   establish which is authoritative.** `docs/pine/linemap-clouds.md:190-191` says
   Clouds' fills are *"Pine **bucket 2**, so `'normal'` + `drawBackground()` per
   `zorder.js`, below the plots"* — which sides with the unconsumed map.
6. **Whether carrying hidden anchors is a D1/D2 revisit.** `paneGate.js` does not
   contain the `!o.hidden` filter — it lives in `memberPaneDefinition.js:100`. On the
   code, changing it is not a change to `paneGate`. But D2's charter sentence
   (`paneGate.js:3-8`) is about "what a pane is ALLOWED to draw", and
   `memberPaneDefinition.js:89-92` reads as a product rule of the same family. **I
   could not settle this by reading and I am routing it as a ruling, not deciding it.**
7. **Whether TradingView's cloud is 20 real fills or one gradient.**
   `linemap-clouds.md:76-80` explicitly warns the linemap *"is not read as a
   specification for 21 series"* and `:193` states *"only the two MAs need data
   columns"*. That is a presentation question I did not resolve and must not.
8. **The `EMA(close, 20)` seed residual** is recorded UNVERIFIED at
   `linemap-clouds.md:195-200` (up to **0.02** divergence, consistent with warm-up).
   It bears directly on (j)'s per-series numbers and is not settled.
9. **I did not verify that `MemberPane.jsx` reaches a real chart in production.** I
   read its install path (`MemberPane.jsx:115`, `:176`) and the flag
   (`memberPaneGate.js:28-31`, `=== '1'`, fail-closed). I did not check any
   environment for `VITE_PINE_MEMBER_PANE_ENABLED`.
10. **No rail asserts the 2-of-23 fact.** `memberPaneDefinition.test.js` contains no
    occurrence of `clouds`, `hidden` or `fill`. So the central number of this scoping
    read is protected by nothing in the suite (G11), and a change could move it
    silently.

---

## 8. ⛔⛔ OWNER-RULING TRIGGERS FOUND

The stop list is `docs/pine/WAVE2-A-PLAN.md:1899-1902`:

```
A 12th `NODE_TYPES` member · a 42nd `REFUSALS` entry · a modification to the **block
walk** · a revisit of **D1/D2** · a change to the pane renderer outside (j)'s scoped plan
· removal of a working capability · a merge to master. **Those are rulings, not
judgement calls.**
```

Measured against what I read:

| trigger | current value | found in (j)'s path? |
|---|---|---|
| **12th `NODE_TYPES` member** | `NODE_TYPES` is **11** — `parse.js:378-384`, `['num','series','op','call','offset','tf','sym','tf_live','str','symtext','textop']` | **NOT FOUND.** A conditional colour already travels as an ordinary canonical tree (`pine.js:12522-12527`, `ctx.resolver.resolve(cond.test)` + `printFormula` + `verifyRoundTrip`). ⚠️ I could not establish whether a colour that is a USER-FUNCTION CALL (G7) can be resolved into an existing node type — that is unread. |
| **42nd `REFUSALS` entry** | `pine.js:187-386` holds exactly **41** top-level entries | **NOT FOUND for Clouds today** — Clouds refuses **0** on both lanes (`fillColourCarriage.test.js:110-111`). Any new refusal code is a stop. |
| **modification to the block walk** | — | **NOT FOUND.** a3 already unrolls Clouds' `for` loop and the acceptance is green (`vectorUnroll.test.js:34` `const run = it`, `:50-70`). |
| **revisit of D1/D2** | `PANE_LANE = 'host'` (`paneGate.js:44`) | ⚠️ **AMBIGUOUS — ROUTED, NOT DECIDED.** See §7 item 6. The `!o.hidden` filter is NOT in `paneGate.js`; it is `memberPaneDefinition.js:100`. Whether relaxing it is a D2 revisit is an owner call. |
| **a change to the pane renderer beyond fills** | — | ⛔⛔ **FOUND — TWO.** (a) `binder.js:824`, the hidden-plot skip in pass one, is the HIDDEN-PLOT path, not the fill path; nothing in (j) can draw a cloud without that line changing behaviour or a fill attaching somewhere other than its own plot's series (`binder.js:1025`). (b) `memberPaneDefinition.js:50` `CARRY_MAX = 12` is the builder's shared import ceiling — *"THE SAME CEILING THE BUILDER'S OWN IMPORT USES"* (`:48`) — so moving it for (j) moves it for the builder too. |
| **removal of a working capability** | — | ⛔ **ADJACENT, FLAGGED.** `memberPaneDefinition.js:89-92` is a deliberate product rule (*"A pane that drew them would be drawing the scaffolding"*) reinforced by ruling 1.2 (`pine.hiddenOnly.test.js:1-26`, the Supertrend/ohlc4 mistranslation and the Butterworth case). Anything that makes hidden rows drawable risks re-opening the defect that ruling closed. |
| **a merge to master** | — | not in scope of this read. |
| **schema addition** (not on the stop list, recorded anyway) | `defSchema.js:1580-1584`; `PLOT_STYLES` 8 members at `:156-158` | Expressing a per-bar fill colour has **no existing field** (G8). Whether that is additive `meta` or a schema change is an owner call. |
