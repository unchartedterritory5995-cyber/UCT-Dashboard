# WAVE C3A — DECLARATIVE + EVENT VISUAL PRIMITIVES

Status: **PARTIAL — the event-marker lane is built and proved; three primitives
are measured and NOT built.** Read C3A.1 before the rest: the census reorders
the argument, and it is the reason this wave stops where it does.

---

## C3A.1 — THE DEMAND CENSUS (frozen 60, source-text)

`app/src/components/chart/builder/visualDemandCensus.test.js`. Counts what
authors WROTE. Comment-stripped, `name(` as a call rather than a substring, and
the raw count reported beside it where they differ.

### Declarative / event — what C3A is authorised for

| primitive | scripts | call sites |
|---|---|---|
| **`plotshape`** | **18/60** | **65** |
| `bgcolor` | 12/60 | 19 |
| `barcolor` | 10/60 | 10 |
| `plotcandle` | 5/60 | 5 |
| `plotchar` | 2/60 | 5 |
| `plotbar` | 1/60 | 1 |
| **`plotarrow`** | **0/60** | **0** |

### Already supported (the C1 baseline)

`plot` 37/60 · `fill` 18/60 · `hline` 11/60

### Mutable object lifecycle — explicitly NOT C3A

`label.new` 30/60 · `table.new` 29/60 · `table.cell` **402 sites** ·
`line.new` 23/60 · `label.delete` 21/60 · `box.new` 20/60 ·
`line.delete` 20/60 · `box.delete` 15/60 · `label.set_text` 8/60 …

### ⛔⛔ THE NUMBER THAT SHOULD DECIDE THE NEXT WAVE

```
scripts wanting ANY C3A primitive:      32/60
scripts wanting ANY object lifecycle:   46/60
scripts wanting BOTH:                   23/60
scripts wanting ONLY C3A primitives:     9/60
```

**C3A moves 32 scripts partway and only 9 the whole way.** The object model is
46/60 and remains the largest single item in the register — C3A does not reduce
it. Stating this plainly is the point of counting the two families apart: summed
together they would produce one big number that justifies building the wrong
thing first.

⭐ **And `plotarrow` has ZERO demand.** It was on the authorization's list; the
corpus does not ask for it. Building a renderer for it would be building for
nobody, so it is **deliberately not built**, and
`plotshapeEndToEnd.test.js` carries a test that records the decision and goes
red if a future corpus does ask.

---

## C3A.2 / C3A.3 — THE PRESENTATION ENTITY, AND ONE EVENT PRIMITIVE

⭐ **It extends the existing presentation specification rather than starting a
second one.** A marker is `plots[i].marker` on a `style: 'markers'` plot:

```json
{ "key": "out2", "style": "markers",
  "marker": { "shape": "arrowUp", "position": "belowBar",
              "text": "BUY", "size": 0.8 } }
```

It references the calculation by the plot key it already had — no calculation
tree is copied into presentation, which is the C2C.13 rule.

⛔ **It is NOT the object model.** There is no id to update, nothing to delete,
and no lifetime beyond the column it reads. That separation is structural, not a
naming convention.

`plotshape` and `plotchar` go through **one** representation. They differ in one
respect a reader cares about — the glyph is a character the author typed — so
`plotchar`'s `char=` becomes the same `text` field, and a `plotchar` with no
`char=` keeps Pine's own default (★) rather than going blank.

### The two vocabularies, and the approximations recorded as such

LWC 5.2 draws **four** marker shapes; Pine names **twelve**. Every mapping
carries the author's shape AND the drawn shape:

| Pine | drawn | approximated |
|---|---|---|
| `shape.circle` / `shape.square` | circle / square | no |
| `shape.arrowup` / `shape.arrowdown` | arrowUp / arrowDown | no |
| `shape.triangleup` / `triangledown` | arrowUp / arrowDown | **yes** |
| `shape.labelup` / `labeldown` / `flag` | arrowUp / arrowDown | **yes** |
| `shape.diamond` / `cross` / `xcross` | square | **yes** |

⛔ **An approximation is recorded (`shapeApprox`), never presented as the
thing.** The wave's instruction is "do not flatten everything into one dot", and
the honest reading is not "refuse nine of twelve" — a triangle drawn as an arrow
at the right bar IS the author's signal; a triangle dropped is not. It is "say
which ones you changed".

⚠️ Directional shapes map to the arrow pointing the SAME way. A `labeldown`
rendered as an up-arrow would be the opposite signal, which is worse than a
different glyph.

`location.top`/`bottom` are pane-relative and LWC has no such position; they map
to the nearest bar-anchored one and are flagged (`positionApprox`).
`location.absolute` is `inBar` — the glyph sits at the value the author plotted.

---

## C3A.4 — `plotshape`, BUILT

⚰️ **What it replaced.** `style = shape.triangleup` used to miss the
`plot.style_*` lookup and be recorded as `styleUncarried: 'shape.triangleup'` —
the author's glyph filed as an unsupported *plot style*, a true sentence about
the wrong thing. The translator's own header said as much: *"WHAT IS NOT
CLAIMED: the GLYPH."*

Chain: `pine.js` presentation → `BuilderSheet` row → `buildDefinition` →
`defSchema.validateMarker` → `binder` → `createSeriesMarkers`.

- **Markers ride the PLOT'S OWN series**, not the candle series. That is what
  makes `inBar` mean `location.absolute` and what keeps a marker in the same
  pane as the oscillator that produced it.
- **Two-colour rules apply to glyphs** through the same `colorMode:
  'column:<key>'` fields a line reads — one authority over one signal.
- `ctx.createSeriesMarkers` is INJECTED like every other chart-library
  capability the binder uses, so a host without it draws no markers rather than
  throwing on a chart that was otherwise fine.

### The rails, and what each kills

`markerPrimitive.test.js` (13) — a marker fails silently in four directions and
each has a test: wrong bars, every bar, no bar, right bars with the wrong glyph.
⛔ **`> 0`, not truthy**: `location.absolute` lets an author hand `plotshape` a
PRICE, and a truthy test marks every bar with a non-zero price — which is every
bar, a chart solid with glyphs, and a rail reading "markers work".
⛔ **NaN is the warm-up pad, not an event.**
⛔ **An identical list is not re-set** — markers are re-derived on every bind.

`plotshapeEndToEnd.test.js` (11) — **mocks nothing on the path under test.**
Every stage had a green test while `plotshape` drew nothing, because nothing
carried the glyph BETWEEN them. It asserts through the real `validateDefinition`
and the real `interpret`, and bounds the marker count from BOTH sides (all-bars
and no-bars are the two silent failures).

Controls: the save gate REFUSES a marker on a line plot (two renderers over one
column) and REFUSES a shape the renderer cannot draw (the "validated but inert"
failure this schema exists to prevent — `colorMode: 'column:<key>'` shipped that
way for a whole wave).

---

## NOT BUILT IN THIS WAVE — measured, named, and honest

| item | demand | why not |
|---|---|---|
| **`bgcolor`** | 12/60, 19 sites | Needs a pane-background series primitive (the C1 fill primitive is the nearest precedent, and it is a between-two-series shape, not a full-pane one). Real work, not a line of glue. |
| **`barcolor`** | 10/60, 10 sites | Recolours the CHART'S OWN candles from an indicator's column — it reaches across from the definition into the host's price series, which is a wiring question C3A did not settle. |
| **`plotcandle` / `plotbar`** | 5/60 + 1/60 | Needs a real secondary candle series. The four role columns already exist (`open`/`high`/`low`/`close`); what does not is a second candlestick series bound to them. ⛔ Flagged in the authorization as a prior silent-false-success path — so it is left refusing honestly rather than half-drawn. |
| **`plotarrow`** | **0/60** | Zero demand. Not built on purpose; a test records the decision. |
| **declarative event labels** | — | The boundary is drawn but nothing is built on it: a `label.new` whose id is stored, updated or deleted is object lifecycle (C3B) and no attempt is made to represent it as an event. |
| **C3A.12 TradingView comparison** | — | **NOT RUN.** The marker lane is proved against the product's own renderer input, not against a TradingView capture. Claiming visual parity without that capture would be the "assumed-verify" failure this program has already paid for once. |

⛔ **NONE OF THESE IS CLAIMED AS SUPPORTED.** A numeric column surviving without
its glyph is exactly what `plotshape` was before this wave, and calling that
support is the failure mode the wave exists to end.
