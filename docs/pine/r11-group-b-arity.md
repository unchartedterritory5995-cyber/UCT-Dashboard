# R1.1(d) — Group B, measured: corpus-used arity vs table-declared arity

The R1.1 gap analysis put nine names in **Group B — "supported names, rejected arity"**, and
called it *"the cheapest reach per unit of work in the whole list"*. This is that claim
measured against the 266-script corpus and against `closedTable.json` itself, before anything
is widened.

⛔ **NOTHING HERE IS WIDENED YET, AND THAT IS THE POINT.** Every extra-argument form below is a
question for the vendor, not an inference from the name. `ta.tr(true)` is the template: the
argument does not add an option, it **changes the maths** (`true` uses the previous close in
the true-range calculation, `false` does not). A signature widened from its shape rather than
from a measurement is a wrong number nobody will see.

---

## The table

Measured 2026-09-09 over `corpus/committed` (266 scripts). "Declared" is read out of
`closedTable.json::functions`; "required" counts the non-optional arguments there.

| name | declared | required | corpus-used arity | scripts | verdict |
|---|---:|---:|---|---:|---|
| `vwap` | 0 | 0 | **1-arg** ×7 | 3 | widen — needs vendor read |
| `breakout` | — | — | 2-arg ×8 | 2 | ⛔ **NOT AN ARITY CASE — see below** |
| `ta.lowest` | 2 | 0 | 1-arg ×41 · 2-arg ×79 | 54 | widen — needs vendor read |
| `ta.highest` | 2 | 0 | 1-arg ×40 · 2-arg ×93 | 59 | widen — needs vendor read |
| `pivothigh` | 3 | 0 | 2-arg ×1 · 3-arg ×5 | 6 | widen — needs vendor read |
| `barssince` | 2 | 0 | **1-arg ×12** | 7 | ⚠️ **the table looks wrong** |
| `math.max` | 2 | 0 | 2-arg ×394 · 3-arg ×8 · 5-arg ×1 | 84 | variadic — needs vendor read |
| `math.round` | 1 | 0 | 1-arg ×149 · **2-arg ×101** | 59 | widen — needs vendor read |
| `pivotlow` | 3 | 0 | 2-arg ×1 · 3-arg ×5 | 6 | widen — needs vendor read |

---

## ⛔⛔ `breakout` IS NOT A BUILT-IN, AND GROUP B IS EIGHT NAMES

`breakout` appears in **no section** of `closedTable.json` — not `functions`, not `series`,
not `scalars`. Both scripts that call it **define it themselves**:

```
breakout(...) =>          # a user function declaration, in the same file, in both scripts
```

So it was never "a name we already support, called with an argument count we reject". It is a
**user-defined function the translator did not resolve**, which is a different defect with a
different fix and a different guard. Widening an arity for it would be widening the arity of
something that does not exist.

⚠️ **How it got here matters more than the row.** Group B was assembled from *refusal tokens* —
the name the lexer was looking at when the refusal fired. A user function and a built-in
produce the same-looking token, so the grouping could not tell them apart, and the name
inherited "we already support this" from the group it landed in. This is the same shape as
`pine:state` reporting `[` as its token for 97 sites, already flagged one section over in
`r11-vocabulary-gap.md`: **a token is not a name, and a name is not a capability.**

✅ **Group B is 8 names, 28 sites.** `breakout` moves to the user-function conversation.

---

## ⚠️ `barssince` — the corpus disagrees with our own table, and the corpus is probably right

We declare `barssince(series, int)`. Every one of the 12 corpus call sites passes **one**
argument, and TradingView's own signature is `ta.barssince(condition)` — one argument, "the
number of bars since `condition` was last true". A second parameter has no evident meaning.

⛔ **So this is very likely not a widening at all but a WRONG DECLARATION** — and the direction
matters: if the table is wrong, "widening to 1" would be *narrowing to the truth*, and the
2-arg form we currently accept is a form the vendor may reject outright. That has to be read
off the vendor before either arity is touched, because the two possible fixes are opposite.

---

## What each one needs measured, and why the answer is not guessable

| name | the question for the vendor |
|---|---|
| `ta.highest` / `ta.lowest` | ✅ **ANSWERED 2026-09-10 — THE ASYMMETRY IS REAL.** `ta.highest(n)` defaults to `high`, `ta.lowest(n)` to `low`; not `close` for either, and not `hl2`. 397 of 397 usable bars agree, zero agree with any rival. Capture: `tests/fixtures/vendor/groupb-hilo-default-spy-1d-2026-09-10.json`; the door is pinned to it by `pine.hiloDefault.test.js`. ✅ **THE DOOR TRANSLATES IT** since 2026-09-11, via `PINE_SHORT_FORM` at the ARITY layer. ⚰️ A first attempt put the names in `PINE_NAMESPACED_TREE`, which reclassified them out of the runtime's carried/windowed set and broke the two-argument form; that was reverted, and those tests are now the control. ⚰️ This said **81 sites**; re-measured on the same day by balanced-paren scan over all 510 tracked `.pine` files it is **97 one-argument sites across 33 files** (and 325 two-argument ones, which were never in doubt). The corpus grew and the number did not — the risk was understated, never overstated. |
| `pivothigh` / `pivotlow` | 2-arg `(left, right)` — same defaulting question, same asymmetry. |
| `math.round` | 2-arg `(x, precision)` — half-up or banker's rounding, and what a negative precision does. 101 sites. |
| `math.max` | genuinely variadic, or capped? A 5-arg call exists in the corpus. |
| `vwap` | we declare **zero** arguments; the 1-arg form takes a source. Does `vwap(hlc3)` anchor the same way the no-arg form does? |
| `barssince` | which arity is real — see above. Opposite fixes. |

⭐ **Each needs a fixture before `closedTable.json` moves**, in the shape the other vendor
resolutions in this repo already use: the call, the vendor's per-bar answer, and the bar range
that distinguishes it from the wrong answer. Eight names is not a batch; it is eight readings.

---

## Why this is still the cheapest reach

Even at eight names, the sites are concentrated: `ta.highest`/`ta.lowest` alone are **113
sites across 59 and 54 scripts**, and `math.round`'s 2-arg form is 101 sites across 59. No new
nodes, no new grammar — the trees already exist. What it costs is **eight vendor readings**,
not eight guesses, and the `breakout` row is the standing argument for why the readings come
first.
