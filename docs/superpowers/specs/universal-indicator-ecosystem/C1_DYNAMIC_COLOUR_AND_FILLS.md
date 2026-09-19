# C1 — DYNAMIC COLOUR + FILL / BANDS

**Both capabilities are implemented, live-verified on a real chart, and proven by an
A/B pixel measurement rather than by inspection.** Two Pine visual behaviours that
had never reached a UCT chart now do:

- a plot coloured by a **condition** (`color = up ? green : red`), drawn per point;
- a **band** between two plots (`fill(plotA, plotB, colour)`), drawn as a filled area.

**Neither existed before C1 in any form.** Across the corpus runs, saved documents
now carry **4 dynamic-colour rules across 2 definitions** and **6 bands across 4
definitions**, where the previous count for both was zero.

---

## A — DYNAMIC COLOUR

### The mechanism, and why it needed no new schema

`defSchema` has carried `colorMode: 'column:<key>'` since v1 — validated,
reference-checked, and **drawn by nobody**. Its own comment named the two places
that would have to learn it (`signColorsForPlot` and `binder.toPoints`) and said "a
test asserting per-point colours is the thing to write first". C1 is that work.

```
Pine    plot(x, color = up ? color.green : color.red)
          ↓  pine.js — the CONDITION becomes a canonical tree
translator  presentation: { colorUp, colorDown, colorCondition: {ast, formula} }
          ↓  PineBox — carried per output
BuilderSheet  a HIDDEN plot row holds the condition; the visible row gets
              colorMode: 'column:<hiddenKey>', colorUp, colorDown
          ↓  buildDefinition — an ordinary multi-tree document
binder      pool.columnColorsForPlot → toPoints colours each point by whether
            the named column is non-zero on that bar
```

⛔ **THE CONDITION RIDES AS A COLUMN, NOT AS AN EXPRESSION IN THE PRESENTATION.** A
colour rule that re-derived `close > ma` presentation-side would be a *second
evaluator* over the same data, free to disagree with the one that drew the line. It
rides as an ordinary hidden column instead: one evaluator, one answer, and every
existing rail (the formula field, the read-back, the save gate, the repaint linter)
applies to it unchanged.

⛔ **A NON-FINITE CONDITION GETS NO COLOUR, NOT `down`.** `na` is the author saying
nothing on that bar. Painting it the "false" colour would show a real-looking signal
through every warmup bar of the condition's own lookback.

### What is carried, and what is measured-and-declined

Measured over the frozen 60 (`5df718c2`), **49 scripts colour from an expression**.
The colour reader now also resolves a name to its binding — which turned out to
matter more than the conditional itself:

| Class | Rows | Answer |
|---|---|---|
| static colour behind a NAME (`C = #5C8E33; plot(x, color = C)`) | 20 | **now carried as a static colour** — previously reported "an expression this door cannot say", and the plot drew in the builder's default |
| 2-way conditional between two static colours | carried | **`colorMode: 'column:'`** |
| `input.color(default, …)` | carried | the author's **default** colour (the knob is not a Track F kind and is reported skipped) |
| `cond ? colour : na` — a visibility gate written as a colour | 16 | **declined, named** (`colorNaGated`) |
| `plotcandle` payload | 12 | out of scope (object model) |
| N-way chains (3 and 4 colours) | 8 | **declined, with the ARITY measured** (`colorDynamicArity`) |
| `var color X = …` bindings | some | **declined** — a `var` binding is not followed, because a reassigned one would yield a wrong colour |

⭐ **THE ARITY IS THE USEFUL PART.** "Dynamic colour is uncarried" is a fact nobody
can act on. *"This rule needs 4 colours and a plot holds 2"* names the exact
capability a future wave would add, and it is measured per output rather than
estimated once. `ttm-squeeze` wants four; `coppock-curve` wants three.

⛔ **A BRANCH THAT IS NOT A STATIC COLOUR IS NEVER GUESSED.** `cond ? green :
color.new(red, close)` fades per bar; reading only the base and calling it static
would hand the member one flat red and lose the whole effect. That case is pinned.

---

## B — FILL / BANDS

### The measurement that chose the implementation

**35 `fill()` calls across 18 scripts, and 33 of the 35 join two PLOTS.** Exactly one
joins two `hline`s.

Lightweight-charts can fill a series to a fixed price natively (`BaselineSeries`) and
building only that would have been a fraction of the work — **and would have served
one of the thirty-five.** A capability built for a demand that is not there is worse
than none: it reads as support in every summary. So the renderer is a series
primitive (`engine/fillPrimitive.js`), following `sessionShadingPrimitive`'s shape so
there is one way primitives are written here, not two.

### Pure core, thin shell

Canvas code cannot be unit-tested, so as little as possible of it is canvas code.
`fillRuns` / `runPolygon` / `fillPolygons` are pure functions over two columns and
answer the whole question — which spans fill, and where each starts and stops. The
`draw` is a dumb consumer.

⛔ **A GAP IS NEVER BRIDGED.** Two plots that both go `na` and come back show a HOLE.
A band drawn across missing data asserts a relationship the indicator never computed
and is invisible as a bug — it looks exactly like a band.

⛔ **AND THE LIFECYCLE IS THE OTHER HALF.** A primitive attaches to a SERIES, and this
engine's series outlive their tenants by design. The binder attaches **once** and
thereafter only re-feeds through `setOptions` (re-attaching per frame stacks one
primitive per repaint, with no handle anybody counts), and **detaches on a
re-tenant** (or the previous indicator's band paints over the new one's numbers).
Both are pinned.

---

## ⛔⛔ TWO BUGS THAT EVERY UNIT TEST PASSED THROUGH

Recorded because both were invisible to a green suite, and only one instrument
caught them: an **A/B pixel diff** of the same saved definition with the fill removed
via the API and the chart reloaded.

### 1. `break` on the first unresolvable coordinate

`runPolygon` stopped at the first point whose coordinate was null. The reasoning was
sound for an *interior* null — stitching across it drags the band's edge to whatever
the next resolvable bar happens to be — but it was wrong about **where** nulls occur:
`timeToCoordinate` answers null for every bar outside the **visible range**, and a
chart holds 5,000 bars while showing ~200. The very first bar is essentially always
off-screen, so the first point ended every polygon. Now a null **splits** the run,
which keeps the no-bridging rule and survives the off-screen head and tail.

### 2. `Array.isArray` on a column

`fillRuns` bounded its walk with `Array.isArray(upper) ? upper.length : 0`. **This
engine's columns are typed arrays.** `Array.isArray(Float64Array)` is false, so the
length collapsed to 0 and `runs=0`. Live instrumentation read `up=600/581
lo=600/581 … runs=0`: 581 finite values in each column, every coordinate resolving,
the fill style valid, and nothing drawn.

⭐ **SIXTEEN GREEN TESTS AND `attach ok=true` ON THE LIVE CHART, AND THE BAND DREW
NOTHING.** Every fixture passed plain arrays — a fixture that cannot take the shape
the caller actually sends is not a fixture. Both are now pinned, the second with a
`Float64Array` case.

---

## LIVE PROOF

Permanent first-party fixtures: `tests/fixtures/pine_c1/` — dynamic colour, a fill
band, and both on one indicator.

**3/3 FULL_JOURNEY_PASS** (`tools/c1_out/report.json`): import → apply → save →
render → close → reopen, with the reopened definition byte-identical to the saved one.

### The A/B pixel measurement

Same saved definition, fill stripped via `PUT /api/user-definitions/{id}`, chart
reloaded, screenshots diffed over the plot region:

| | changed pixels |
|---|---|
| before the two bugs were fixed | **47** — all at the price axis, none in the band |
| after | **86,811** of 637,720, spanning (0,24)–(1050,489) |

⛔ **THE 47 IS THE CONTROL AND IT IS WHY THIS SECTION EXISTS.** The band lines were
on screen, the primitive reported `attach ok=true`, the screenshot *looked* plausible,
and the fill was not being painted at all. A screenshot is not a measurement.

⚠️ The probe also had to learn to require a **live instance**: stripping the fill from
a definition nobody instantiated changes no pixels and reads exactly like "the fill
draws nothing".

---

## CORPUS MOVEMENT

| Population | PRE-C0R | POST-C0R | POST-C1 |
|---|---|---|---|
| 18 accepted OOS | 9 renderable · 8 SAVE_BLOCKED · 1 import | **13 FULL_JOURNEY_PASS** · 2 SAVE_FAILED · 2 partial · 1 import | **13 · 2 · 2 · 1** |
| Parity set (10, unchanged) | 6 renderable · 1 partial · 2 import · 1 save | **6 · 1 · 2 · 1** | **6 · 1 · 2 · 1** |
| C1 fixtures (3) | — | — | **3/3 FULL_JOURNEY_PASS** |

⛔ **C1 MOVED FIDELITY, NOT THE JOURNEY COUNT, AND THAT IS THE CORRECT SHAPE.** The
scripts that could not save still cannot (the 64 KB document cap and the chart-scale
compute budget are C0R's named next blockers, untouched here); the ones that could
now draw closer to what their author wrote. Anyone reading a flat 13 as "C1 did
nothing" is reading the wrong column: the movement is **0 → 4 colour rules and 0 → 6
bands actually carried into saved documents**.

⛔ **AND FULL_JOURNEY_PASS IS STILL NOT VISUAL PARITY.** The parity set's V4/V5 members
continue to lose the presentation classes named above — N-way colour, `na`-gated
visibility, `plotcandle` payloads, and every drawing object. C0.7's 16/18
VISUALLY PARTIAL stands.

## TESTS

New: `__tests__/dynamicColourColumn.test.js` (8) · `__tests__/fillPrimitive.test.js`
(17) · `__tests__/fillBinding.test.js` (5) · `__tests__/hiddenPlotChip.test.js` (4) ·
`BuilderSheet.dynamicColour.test.jsx` (4), plus new cases in
`pine.presentation.test.js`, `defSchema.test.js` and
`compatHarness.level3Fixture.test.js`.

Corrected, claims preserved: `defSchema.test.js`'s *"colorMode column: is
schema-VALID… VALIDATED-BUT-INERT"* and *"no engine module READS the fill field
today"* — both were written to make **this** commit visible, and both did their job
by going red on it. `pine.presentation.test.js`'s *"say so, do not flatten"* keeps its
claim and now meets it by carrying the rule instead of declining to.

Suite: `src/components/chart` — **7,345 passing**, 3 failing, all three identical on
the untouched pre-C0R baseline.
