# Linemap — `Uncharted Clouds`

**Source of truth:** `tests/fixtures/member/uncharted-clouds.pine`, 137 body
lines, `//@version=6`, © AtTheAsk (MPL-2.0). Hashes in
`tests/fixtures/member/manifest.json`.

⭐ **The STATUS column is MEASURED** — the shipped `translatePine` over this exact
file, both contracts, 2026-09-09. CAPABILITY and PHASE are the judgement.

---

## What the translator actually says today

```
SCREENER  OK
HOST      refused  pine:collection  line 64  — `array.get`
lenient: 21 refusals, all `pine:collection`, lines 64–84
```

⭐⭐ **THE TWO CONTRACTS DISAGREE, AND THAT IS THE WHOLE POINT OF STRICT MODE.**
The screener asks *"which columns can you serve me?"* and gets two — the moving
averages — which is a useful answer there. A pane asks *"can you draw this?"* and
two of twenty-three is a **no**: the visual IS the gradient. This script is the
specimen `pineStrictMode.test.js` was written around.

---

## What the source actually declares

⛔ **RECONCILE AGAINST THIS, NOT AGAINST A MEMORY OF IT.** Counted from the file:

| | count | lines |
|---|---|---|
| `plot()` **visible** | 2 | 50, 51 |
| `plot()` with `display=display.none` | **21** | 64–84 |
| `fill()` | 20 | 118–137 |
| **rendered objects a chart model would expose** | **43** | |
| **objects a member can see** | **22** | 2 lines + 20 fills |

⚠️ **A NAÏVE `^plot(` SCAN FINDS 2 AND IS WRONG BY 21.** The layer plots are
written `p1 = plot(...)` — assigned, because `fill()` takes plot *handles*. Any
census of this script that reports "2 plots" has missed the entire mechanism.

---

## The rows

| Line(s) | Pine feature | Capability required | Phase | Status |
|---|---|---|---|---|
| **57** | `var layerArray = array.new<float>(numLayers)` | array declaration | R3 collections | 🔴 outside the expression grammar |
| **59–61** | `for i = 0 to numLayers - 1` … `array.set` | bounded loop writing an array | R3 collections | 🔴 |
| **64–84** | `p1..p21 = plot(array.get(layerArray, i), display=display.none)` | `array.get` as a plot source | R3 collections | 🔴 **21 refusals — the host blocker** |
| **118–137** | `fill(pN, pN+1, color=…)` × 20 | fills between plot handles | R2 presentation | 🔴 |
| **50, 51** | the two visible MA plots | — | — | ✅ **both contracts** |
| **41, 42** | `ta.ema` / `ta.sma` behind a ternary on an input | — | — | ✅ |
| **38, 39** | source selection by string input | — | — | ✅ |
| **9–26** | `input.*` × 12 | — | — | ✅ |
| **102, 111, 114** | 3 user-defined functions | — | — | ✅ |
| **108** | `math.*` | — | — | ✅ |

---

## Reading

⭐ **THE GRADIENT IS ONE MECHANISM, NOT 21 PROBLEMS.** All 21 host refusals are
the same construct at consecutive lines: an array holding interpolated levels,
read back one index per hidden plot, so `fill()` has handles to shade between.
Clearing `array.get` for this shape clears all 21 at once — and clearing nothing
else moves the number at all.

⚠️ **THE 20 FILLS ARE A SEPARATE PHASE AND WOULD STILL BLOCK.** Even with arrays,
this script does not *look* like anything without `fill()`. Arrays are R3,
fills are R2, and this pane needs both — so "Clouds translates" and "Clouds
renders" are different milestones and should not be reported as one.

⚠️ **A 21-LAYER GRADIENT MAY NOT SURVIVE TRANSLATION AS 21 LAYERS.** Nothing here
requires the destination to use hidden plot handles; a renderer with a real
gradient primitive expresses the same visual with one object. That is a
presentation decision for R2, recorded here so the linemap is not read as a
specification for 21 series.


---

# Part 2 — what the VENDOR actually renders

⭐⭐ **TWO INDEPENDENT ROUTES, AND THEY AGREE.** Everything above is read from the
SOURCE (`tests/fixtures/member/uncharted-clouds.pine`). Everything below is decoded
from what the live chart EMITTED — `tests/fixtures/vendor/reference/{A,B,C,D}/
clouds-volume-*.{csv,meta.json}`, captured per `tools/visual_conformance/README.md`,
without reading the source at all.

The source declares **21 `display=display.none` plots and 20 `fill()` calls**.

⭐⭐ **THIS IS THE EVIDENCE STANDARD FOR R2.** The two counts were derived
independently — one by censusing the committed source, one by decoding the chart's
emitted output — by two sessions that had not seen each other's number, and they
agree. Neither is a check of the other; each is a measurement of the same object
from a different direction. Where R2 can get two such routes to a number, it should,
and where it cannot, it should say which single route the number rests on.
 The
emitted output carries **21 layer boundary plots and 20 band-colour plots**. Neither
number was derived from the other. When a source census and a vendor capture land on
the same two integers by different methods, the render model is not a guess.

⚠️ Section numbering below is Part 2's own and does not continue Part 1's.

## 1. ⭐⭐ Forty-five plots, and only two of them are lines you can see

| Plot(s) | Count | What it is |
|---|---|---|
| `plot_0` | 1 | **Fast MA** — `EMA(close, 9)` |
| `plot_1` | 1 | colour of the fast MA |
| `plot_2` | 1 | **Slow MA** — `EMA(close, 20)` |
| `plot_3` | 1 | colour of the slow MA |
| `plot_4` … `plot_24` | **21** | **the cloud's layer boundaries** — hidden, and pure fill anchors |
| `plot_25` … `plot_44` | **20** | one colour per band, between consecutive boundaries |

⭐ **Twenty-one layer plots.** That is the number `pine.js` already records from the translator
side — *"all twenty-one plots that make up its cloud came back with a `null` formula"* — arrived
at here completely independently, by counting what the chart emits. The two agree.

**21 boundaries → 20 bands → 20 colours.** That arithmetic is the whole render model.

## 2. The layers are an exact linear ramp between the two MAs

Measured over all 250 bars of set A:

| Claim | Result |
|---|---|
| `plot_4` equals the fast MA (`plot_0`) | max abs delta **0.0000000000** |
| `plot_24` equals the slow MA (`plot_2`) | max abs delta **0.0000000000** |
| the 21 layers are linearly spaced between those endpoints | max abs deviation **0.0000000000** |

So layer *k* is `fast + (slow − fast) × k / 20`. Nothing is smoothed, offset, or clamped — a
renderer can compute all 21 from the two MAs, and does not need 21 columns of data.

⚠️ **But it still needs 21 SLOTS.** These are real plots that consume real budget, and Pine
charges for a plot whether or not it is drawn (see `objectPool.js` for the drawing-object
analogue). They are also the reason Clouds is the natural stress case for hidden-plot handling:
`display.none` is an author's choice, not an absence of data.

## 3. ⭐ The colour encoding is `0xTTBBGGRR` — transparency, then BGR

A colorer plot's value is a 32-bit integer, and the byte order is **not** what a reader expects:

```
226597128  = 0x0D819908  ->  transparency 0x0D = 13,  colour 0x08 0x99 0x81  =  #089981
2253328008 = 0x864F0E88  ->  transparency 0x86 = 134, colour 0x88 0x0E 0x4F  =  #880E4F
```

⛔ The three colour bytes are stored **B, G, R** after the transparency byte. Reading them as RGB
gives `#819908` — a plausible-looking olive that is simply wrong, and wrong in a way that renders
without complaint. The tell is that the correct reading lands exactly on two Pine palette
constants, and the incorrect one lands on nothing.

## 4. Two states, and the two colours are Pine palette constants

Every one of the 20 band-colour plots carries exactly **two** distinct values across the whole
capture, selected by whether the fast MA is above or below the slow:

| State | Colour | Pine constant |
|---|---|---|
| `fast ≥ slow` | `#089981` | **`color.teal`** (the v6 value) |
| `fast < slow` | `#880E4F` | **`color.maroon`** |

⭐ `#089981` is precisely the v6 `color.teal` that `versionRender.js` encodes, and `#880E4F` is
`color.maroon` from the same table — a third independent route to the palette, after the spec's
own table and the chart's candle colours. Note that under **v5** `color.teal` is `#00897B`, so a
renderer that ignored the script's `@version` would tint this entire cloud wrong.

## 5. The gradient is a transparency ramp, not a colour ramp

The hue never changes across the cloud. What changes is the transparency byte, evenly, from the
fast-MA edge to the slow-MA edge:

```
13, 19, 25, 32, 38, 45, 51, 57, 64, 70, 77, 83, 89, 96, 102, 108, 115, 121, 128, 134
```

Twenty steps of 6–7 (a 0–255 byte carrying Pine's 0–100 transparency, so ≈5% → ≈53%). The band
nearest the fast MA is the most opaque; the cloud fades toward the slow MA.

The two MA lines themselves are **white** (`#FFFFFF`), the fast one fully opaque
(transparency 0) and the slow one at 13 — the same value the first band uses.

## 6. What the renderer must do

1. Two `plot` series for the MAs, white, one opaque and one slightly transparent.
2. Twenty `fill` regions between consecutive layer boundaries — Pine **bucket 2**, so
   `'normal'` + `drawBackground()` per `zorder.js`, below the plots.
3. Each fill takes one of two hues by a per-bar boolean, at a per-band fixed transparency.
4. The 21 boundaries are computable from the two MAs; only the two MAs need data columns.

⚠️ **UNVERIFIED — the `EMA(close, 20)` seed.** `plot_0` matches a textbook `EMA(close, 9)` to
**7e-6**, but `plot_2` differs from a recomputed `EMA(close, 20)` by up to **0.02** under either
seeding convention (first value, or SMA of the first window). The capture window starts 50 bars
into the chart's history, so the residual is consistent with warm-up rather than a different
formula — the 9-period converges far faster than the 20-period, which is exactly the pattern
warm-up predicts. Confirm it against a capture that starts at the series' first bar before
treating the slow MA as settled.

⚠️ **UNVERIFIED — whether the transparency ramp is linear in Pine's 0–100 units.** The byte steps
alternate 6 and 7, which is what rounding a linear 0–100 ramp into a 0–255 byte would produce,
but the author's actual expression has not been read.
