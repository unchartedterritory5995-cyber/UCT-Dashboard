# WAVE 2 · ITEM (a) — THE ARRAY AND LOOP CENSUS

**Measured 2026-09-14** over **327 scripts**: `corpus/committed` (266) +
`tests/fixtures/pine_oos` (59) + the two member scripts. Comments **and string
literals** stripped before matching.

⛔ **THE STRIPPER CARRIES ITS OWN CONTROL.** This repo has six recorded instances
of a literal-hunting check matching its own prose, so the stripper is asserted
against a probe in which one `array.push` sits in a comment, one in a string, and
one in code — the count must be **1**. It is.

| | |
|---|---|
| files using `array.*` / `matrix.*` / `map.*` | **149 of 327** (46%) |
| files using any loop form | **157 of 327** (48%) |

---

## A. Members by use count

**7,823 member calls in all.** The head is short and the tail is long: five
members are 73% of every call.

| member | uses | files | category |
|---|---|---|---|
| `array.get` | **2,758** | 101 | read |
| `array.size` | **1,102** | 84 | read |
| `array.push` | **851** | 81 | write |
| `array.new` | **582** | 69 | create (generic `array.new<T>`) |
| `array.set` | **375** | 56 | write |
| `array.new_float` | 358 | 76 | create |
| `array.remove` | 209 | 30 | write |
| `array.shift` | 164 | 37 | write |
| `array.new_int` | 148 | 40 | create |
| `array.new_line` | 147 | 34 | create (drawing) |
| `array.new_bool` | 118 | 7 | create |
| `array.unshift` | 109 | 21 | write |
| `array.sum` | 105 | 16 | reduce |
| `array.from` | 100 | 25 | create |
| `array.insert` | 88 | 6 | write |
| `array.new_box` | 87 | 31 | create (drawing) |
| `array.clear` | 83 | 20 | write |
| `array.pop` | 69 | 17 | write |
| `array.new_label` | 64 | 22 | create (drawing) |
| `array.max` | 33 | 17 | reduce |
| `matrix.new` | 29 | 6 | create |
| `array.fill` | 23 | 6 | write |
| `array.min` | 20 | 9 | reduce |
| `array.copy` | 19 | 11 | create |
| `array.indexof` | 18 | 7 | reduce |
| `array.new_string` | 16 | 7 | create |
| `array.avg` | 14 | 9 | reduce |
| `matrix.get` | 13 | 4 | read |
| `map.new` | 11 | 7 | create |
| `array.last` | 11 | 2 | read |
| `matrix.set` · `array.sort` | 10 each | 4 · 7 | write · reduce |
| *(25 more, each ≤ 9 uses)* | 63 | — | — |

**By category:** read **3,890** · write **1,986** · create **1,063** ·
reduce **236** · other **648**.

⭐ **THE RANK ORDER IS THE BUILD ORDER FOR a2.** `get`, `size`, `push`, `new`,
`set` — in that order — buy 73% of all member calls. `first`/`last` are 13 uses
between them and belong at the end of a2, not the middle.

⚠️ **`matrix.*` is 76 calls across 6 files and `map.*` is 11 across 7.** Neither is
on Clouds' path. They are named here so the decision is deliberate: **(a) does not
implement them**, and they keep refusing by name.

---

## B. Loop forms

**1,316 loops.**

| form | count |
|---|---|
| `for i = a to b` | **1,004** |
| `while` | 116 |
| `for x in` | 92 |
| `for i = a to b by step` | 70 *(subset of the 1,004)* |
| `for [i, x] in` | 34 |

### The upper bound of every `for i = a to b`, resolved transitively

Names are resolved through the file's whole assignment table, not just top-level
integer literals.

| bound resolves to | count | share | decidable at plan time? |
|---|---|---|---|
| **`array.size(...)`** | **277** | 27.6% | **yes, IF the array's max size is bounded** |
| **literal** | **258** | 25.7% | **yes** |
| **input** | **108** | 10.8% | **yes** — R-J / `boundByDeclaredMaxval` |
| series | **56** | 5.6% | **NO — this is the refusal set** |
| unresolved by this instrument | 305 | 30.4% | **unknown — a1 decides these** |
| | **1,004** | | |

⛔⛔ **THE 305 ARE A PROPERTY OF THIS CENSUS, NOT OF THE CORPUS.** A first pass put
**479** in that bucket because it only knew names assigned a bare integer at top
level; resolving transitively moved 174 of them into decidable buckets. The
remaining 305 are names this regex cannot follow — locals inside user functions,
reassignments, multi-line expressions. **a1 resolves them with the engine's own
constant folder, which is the whole point of a1.** Reporting them as "undecidable"
would be reporting the instrument.

⭐ **So the measured floor is 643 of 1,004 decidable (64%) and 56 (5.6%) genuinely
series-dependent**, before a1 has run. The interesting number is not the 64% — it
is that only **5.6% must refuse**.

**Nesting depth, by file:** 2→44 · 3→43 · 5→21 · 4→19 · 1→17 · 6→9 · 7→2 · **9→2**.
The two at depth 9 are `volume-footprint-measuring-classical-indicators…` and
`mid_engagement__23-distilled-htf-po3`; at 7, `stop-loss-clustering-breakouts…`
and `footprint-iq-pro-tradingiq`.

---

## C. What the loop bodies do

| category | loops |
|---|---|
| array mutation / access | **663** |
| numeric accumulation only | 452 |
| **drawing per iteration** (`label`/`line`/`box`/`table`.new or set_*) | **316** |
| `break` / `continue` | 132 |
| `request.*` inside a loop | **1** |

⛔ **316 LOOPS DRAW, AND THAT IS A QUARTER OF THEM.** Per the design rule, a loop
that draws refuses **at the draw call**, pointing at the drawing-layer item — so
the loop machinery can land without waiting for it. This number is why that rule
matters: implementing loops without it would turn 316 loops from a clean refusal
into a wrong picture.

⭐ **`request.*` inside a loop is ONE call in 327 scripts.** It was predicted to be
rare; it is rarer than that. It refuses, and the cost of refusing it is one script.

---

## D. Uncharted Clouds — the whole array surface, line by line

Measured through `translatePine` on the merged tree, **both lanes**:

```
mode=host      ok=true  outputs=23  refusals=21
mode=screener  ok=true  outputs=23  refusals=21
  pine:collection  x21   lines 64,65,…,84
```

**All 21 refusals are one guard on one member.** Verbatim:

> `pine:collection` — *"an array, a matrix or a map is outside the expression
> grammar this engine runs — `array.get`"*

| line | code | what feeds it |
|---|---|---|
| 30 | `numLayers = 21` | **a literal.** Not an input, not a series. |
| 57 | `var layerArray = array.new<float>(numLayers)` | size is that literal ⇒ **statically bounded at 21**; `var` ⇒ persists across bars |
| 59 | `for i = 0 to numLayers - 1` | **literal-derived ⇒ exactly 21 iterations** |
| 60–61 | `ratio = i / (numLayers - 1)`, `layerValue = fastMA + (slowMA - fastMA) * ratio` | loop-local arithmetic over two series MAs |
| 62 | `array.set(layerArray, i, layerValue)` | array mutation, **no drawing, no request** |
| 64–84 | 21 × `plot(array.get(layerArray, <0…20>))` | **constant indices**, one per plot |

⭐⭐ **CLOUDS IS THE MOST DECIDABLE SHAPE THE GRAMMAR HAS.** Literal size, literal
loop bound, constant read indices, no drawing in the body, no `request.*`, no
`while`, no nesting. It needs exactly three capabilities: `array.new<T>(const)`,
`array.set(arr, i, v)` inside a const-bounded loop, and `array.get(arr, literal)`.

### ⚰️ AND THE CENSUS FOUND SOMETHING THE REFUSAL LIST DOES NOT SAY

The 21 refusals are all **reads**. What builds the array is recorded three
different ways, and one of them is not recorded at all:

| line | how it is recorded today |
|---|---|
| 59 `for` | a **NOTE**, `pine:block` — *"a Pine block spans several statements and this engine stores a single expression"* |
| 62 `array.set` | `objectDiagnostics.loopBlocked: 1`, `loopBlockedCalls: ["array.set"]` |
| **57 `array.new<float>(…)`** | **nothing.** `"line":57` appears nowhere in the result; the string `array.new` appears **0** times. |

⛔ **A `var x = array.new<float>(n)` DECLARATION IS SILENTLY ABSENT** — not
refused, not noted, not counted in `objectDiagnostics`. Today that is harmless
because every read of it refuses anyway. It stops being harmless the moment reads
work: a member whose array was never created would get `na` from a read that
succeeded, with nothing anywhere saying why. **This is a a2 acceptance condition,
not a a2 nice-to-have.**

### The predicted next guard, by line

Once `pine:collection` clears for `array.new` / `array.set` / `array.get`, the next
blocker on Clouds is **`color.t(...)` at lines 90 and 91**
(`bullUserTransparency = color.t(bullColor)`), with the derived
`transparencyStep` at 97 behind it. That is a colour helper, not a collection —
so the (a) acceptance is *"the 21 `pine:collection` refusals clear and the next
refusal names `color.t` at line 90"*, and `color.t` is the first thing (a) does
**not** promise.

---

## E. What this census settles for the design

1. **a2's member order is measured**, not chosen: `get` → `size` → `push` → `new`
   → `set`, then `new_float`/`new_int`/`from`, then the reductions.
2. **Only 5.6% of `for` bounds are series-dependent.** The refusal set is small and
   nameable; the decidable majority is the normal case, not the exception.
3. **`array.size(...)` as a bound is 27.6%** — the single biggest decidable class,
   and it is decidable *only through the bounded-size rule*. That rule is load
   bearing for a quarter of all loops, not an edge case.
4. **316 loops draw.** The "a loop that draws refuses at the draw call" rule is
   what lets (a) ship without the drawing layer.
5. **Clouds needs the three simplest operations in the census**, which makes it a
   target that tests the machinery without exercising its hard edges — and
   `matrix`, `map`, `while`, nesting and drawing-in-loops all stay refused.

---

## F. RULINGS ON (a), FROM THIS CENSUS — owner, 2026-09-14

### F1. The scope of (a), by census rank

**IN:** `get` · `size` · `push` · `new` / `new_float` / `new_int` / `new_bool` ·
`set` · `remove` · `shift` · `unshift` · `sum` · `from` · `insert` · `clear` ·
`pop` · `max` / `min`.

That is **7,272 of the 7,823 measured member calls (93.0%)** — the scope is the
census's own head, not a guess at one.

**OUT, and each refuses BY NAME pointing at the item that owns it:**

| out | measured | refuses pointing at |
|---|---|---|
| `matrix.*` | 76 calls, 6 files | a later item |
| `map.*` | 11 calls, 7 files | a later item |
| `array.new_line` · `new_box` · `new_label` *(and `new_linefill`)* | **299 calls, 60 files** | **the drawing-layer item** |

⛔ **A TYPED DRAWING ARRAY IS DRAWING, NOT DATA**, and it refuses **at creation**,
not at first use. `array.new_label(...)` is a request for 64 labels; admitting the
container and refusing the draw would accept a shape whose only purpose is the
thing (a) does not do. Same reasoning as "a loop that draws refuses at the draw
call": the refusal is placed where the intent is visible.

### F2. Line 57 is an a2 ACCEPTANCE CONDITION

A `var x = array.new<T>(n)` declaration is either **recorded in the plan** — with
its **bounded size `n`**, its **persistence** (`var` vs non-`var`) and its
**element type** — or **refused by name with its line**. **Never absent.**

⛔ **AND THE RAIL IS ON THE READ, NOT ON THE DECLARATION.** Every array-typed name
read anywhere in a tree must resolve to a recorded creation, or the READ refuses
with a named guard. *"Read of an array that was never created"* is a **guard**,
not `na`. A silent `na` from a read that succeeded is indistinguishable from a
member's own empty array, which is exactly the failure the current silence would
become the moment reads work.

### F3. The 305 unresolved bounds are a1's job, not a refusal set

a1 re-buckets them after transitive resolution **through the engine's own folder**.
Whatever is still genuinely undecidable joins the **56 series bounds** as the
refusal set, **with the count**. ⛔ Until a1 has run, "undecidable" is a statement
about the census's regex and must not be quoted as a property of the corpus.

### F4. `while` (116 uses) — a1 decides, with a stated threshold

Admit **only** if the guard is decidable to a constant bound — a counter compared
against a literal, an input (R-J), or a bounded array size. Otherwise refuse by
name. a1 pastes how many of the 116 fall on each side.

⭐ **AND THERE IS A PRE-COMMITTED THRESHOLD, WHICH IS WHAT STOPS THIS BEING
DECIDED BY WHATEVER THE NUMBER TURNS OUT TO BE: if fewer than ~20 are admissible,
`while` is refused ENTIRELY in (a) and routed with the count.**

### F5. The iteration ceiling is DERIVED in a1

From the **max statically known iteration count × nesting**, times a multiple that
still bounds a runaway. Recorded the way `TEXT_MAX_DEPTH` and **R-Q** are: the
derivation in the commit, the constant with a docblock, mirrored across both lanes.
Exceeding it records **`loopTooLong` by line** — never a `NaN` cell.

### F6. Acceptance for (a) — nothing else counts as done

> Clouds' **21 `pine:collection` refusals clear**, and the **next refusal names
> `color.t` at line 90**.

---

## G. a1 — ESTIMATE, STATED BEFORE THE WORK

**90 minutes. 2× stop at 180.**

What that covers: a plan-time bound extractor driven by the engine's own constant
folding (not a second parser — per the standing rule, one reader per source); a run
over all 327 scripts; the shape table with decidable Y/N and the reason for every
N; the `while` split against F4's threshold; the ceiling with its derivation; and
the R-A2-style probe that `maxLookback` and the repaint verdict stay decided for
every admitted shape **before** any fold exists.

⛔ **PAUSE POINT:** if any shape on Clouds' path — lines 30, 57, 59, 62, 64–84 —
comes back undecidable, that is a stop, not a workaround.
