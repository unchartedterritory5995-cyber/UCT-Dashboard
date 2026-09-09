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
