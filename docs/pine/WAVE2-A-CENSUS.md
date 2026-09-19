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

---

# a1 — THE DECIDABILITY PROBE. NO FOLD. **Measured 2026-09-14, ~55 min of a 90 min estimate.**

## a1.0 ⭐⭐ THE FINDING THAT COMES BEFORE THE TABLE: **WHERE CAN A LOOP LIVE?**

Measured, not assumed:

```
NODE_TYPES (definition lane) =
  num · series · op · call · offset · tf · sym · tf_live · str · symtext · textop
```

**There is no statement form and no collection form in the definition lane.** It
is an expression language: `translatePine` lowers a script to ONE expression per
output. Its own header states the contract — *"a statement is only ever REFUSED
when it is on the path from a `plot()`/`alertcondition()` to its value; a statement
nothing reaches is a NOTE, listed, never silently dropped"* — and
`BLOCK_KEYWORDS = {if, for, while, switch}` throws `pine:block` when one is reached.

The IR lane is the other half, and it was measured too:

```
buildRuntimeIr(uncharted-clouds.pine, tf:'D', forming:false)   — with and without symbol
  ok         false
  refusal    pine:collection @ 57
  message    …outside the expression grammar this engine runs — `array.new`
  statements 0
```

⭐ **THE TWO LANES REFUSE THE SAME GUARD AT DIFFERENT LINES**: the IR lane stops at
the **creation** (57), the definition lane at the 21 **reads** (64–84). The IR lane
already does what **F2** asks for — it names line 57. The definition lane's silence
at 57 is therefore a **definition-lane defect against its own stated contract**: a
statement nothing reaches must be a NOTE, and this one is neither refused nor
noted. F2 is not a new requirement; it is that contract being enforced.

## a1.0b ⛔ THE ONE DECISION THAT IS NOT ON FILE — **PAUSE POINT**

(a)'s acceptance is that **the definition lane's** 21 refusals clear. That lane has
no statements and no state, by design. So arrays and loops reach it one of two ways:

| | mechanism | what it costs |
|---|---|---|
| **A** | **COMPILE-TIME UNROLLING.** A `for` whose iteration count is statically known, over an array whose size is statically known, unrolls to N ordinary expression trees. `array.new<float>(21)` becomes a plan-time vector of 21 expression slots; `array.set(arr, i, e)` writes slot `i`; `array.get(arr, 3)` **folds to slot 3's tree**. No new node type, no statements, no second interpreter. | Arrays are **plan-time vectors, not runtime objects**. A `push` whose count depends on a series can never be admitted — not "not yet", *never*, on this lane. |
| **B** | **Put the IR lane on the pane path** — it already has statements and already reaches line 57. | ⚰️ **INVERTED, corrected in place (R19, 2026-09-15).** This read *"that is ruling D2"*. It is not: **D2 is the ruling that the IR lane is NOT on the pane path** — a pane acts on the HOST lane's saved definition. Putting it on is what D2 **defers**, and item (c)'s own line says *"closing the tuple form is what lets D2 be revisited at all."* So B is item **(c)**'s, not item (a)'s, and reaching it means **revisiting D2**, not applying it. |

⭐ **A IS THE LANE'S OWN IDIOM, ALREADY IN USE.** `switch` is the one block keyword
the definition lane reduces today — *"reduced to its one live arm… the subject must
be a string this script FIXES… anything else and every arm would have to exist at
once, which is a menu rather than a column"*. A statically-bounded `for` is the
same argument with a different keyword, and **static decidability is not a
restriction bolted onto unrolling — it is the thing that makes unrolling possible.**
A stays inside every design rule in §3: one evaluator, no re-parse, `maxLookback`
and the repaint verdict decided before the tree runs (each slot is an ordinary
expression tree, so they are decided **by construction**, which is the R-A2 proof
in its strongest form — there is nothing new to prove about them).

⛔ **But A forecloses something permanently and that is a ruling, not an
implementation detail**, so it is put here rather than assumed.

---

## a1.1 `for i = a to b` — statically known iteration counts

| | count |
|---|---|
| decidable **by this probe** | **124** |
| not decidable here — name/expr this probe cannot fold | 631 |
| not decidable here — `array.size(...)` | 216 |
| **not decidable — series** | **33** |

⚠️ The 631 are the instrument again (**F3**): this probe carries a *miniature* of
`bindFoldableWindow`, not the engine's. What matters is the shape of the 124 it can
see:

```
min 1   median 4   p90 31   max 4,998
1–10 iterations   95        201–1,000   4
11–50             19        >1,000      2
51–200             4
```

⭐ **Loops in this corpus are SMALL.** 95 of 124 run ten times or fewer; the median
is **4**. Unrolling a median loop costs four expression trees.

## a1.2 The ceiling's unit is **unrolled nodes**, not iterations

`iterations × nesting`, per file, over the loops this probe can resolve:

| unrolled | file |
|---|---|
| **19,992** | `relative-volume-at-time__gei8CBKbc5` |
| 8,000 | `volume-delta-oi-delta-kioseff-trading` |
| 909 | `bollinger-band-width-percentile` |
| 252 | `multi-timeframe-supply-demand-zones` |
| *(all others < 250)* | |

**Derived ceiling: `MAX_UNROLLED_NODES = 30,000`** — worst measured real **19,992**
× 1.5, the same multiple and the same method as **R-Q** (worst real × 1.5).

⛔ **AND ITS RE-DERIVATION CONDITION IS NAMED, NOT ASSUMED AWAY.** This probe
resolved 124 of 1,004 loops, so 19,992 is a floor on the true max. It is
nonetheless the right input *today*, because **a loop whose bound does not fold is
refused and contributes zero unrolled nodes** — the ceiling only has to bound what
is ADMITTED. At **a3**, with the engine's real folder, the max is re-measured and
the constant re-derived in that commit. Exceeding it records **`loopTooLong` by
line**, never a `NaN`.

## a1.3 `while` — F4's threshold, applied

| guard shape | n | share | admissible? |
|---|---|---|---|
| `array.size(...)` guard | 60 | 51.7% | **no** — needs a *termination proof* (the body must always shrink it), not a bound |
| other / not decidable | 31 | 26.7% | no |
| **counter vs literal** | **15** | **12.9%** | **yes** |
| series guard | 10 | 8.6% | no |
| | **116** | | |

⭐⭐ **15 IS BELOW THE ~20 F4 PRE-COMMITTED, SO `while` REFUSES ENTIRELY IN (a)** and
is routed with the count. The threshold was written down before the number was
known, which is the only reason this reads as a rule being applied rather than a
number being accommodated.

⛔ The 60 `array.size` guards are the tempting ones and they are the reason the
threshold exists: `while array.size(x) > 0` terminates only if the body always
pops. That is a proof about the body, not a bound on the guard, and it is outside
"static decidability" as §3 defines it.

## a1.4 Array creation sizes

| | count |
|---|---|
| creations seen | 1,526 |
| size decidable **by this probe** | 450 |
| size not decidable here | 1,076 |

`min 0 · median 0 · max 3,000`. ⭐ **The median is 0** — the dominant idiom is
`array.new_float(0)` then `push` in a loop, so **array size is usually decided by
the loop bound, not by the creation argument**. That makes the bounded-size rule
and the bounded-loop rule the same rule, which is a simplification worth having
before a2 starts rather than after.

## a1.5 Clouds' path — **every shape decidable**

| line | shape | decidable? |
|---|---|---|
| 30 | `numLayers = 21` | **yes** — literal |
| 57 | `array.new<float>(numLayers)` | **yes** — size folds to 21 |
| 59 | `for i = 0 to numLayers - 1` | **yes** — 21 iterations |
| 62 | `array.set(layerArray, i, …)` | **yes** — index is the loop variable, bounded by the loop |
| 64–84 | `array.get(layerArray, 0…20)` | **yes** — constant indices |

Unrolled cost: **21 nodes.** Against a 30,000 ceiling. **No shape on Clouds' path
is undecidable**, so the §6 pause condition does not fire — the pause is a1.0b,
which is a different question.

## a3 — THE ACCEPTANCE IS ON RECORD BEFORE THE FIX

`app/src/components/chart/engine/ast/vectorUnroll.test.js`, committed while the
unroll is still broken. Four cases per lane carry `it.fails` behind a single
`STILL_OPEN` marker that the fix commit deletes; the fifth is a permanent control.

⚰️ **WHY IT IS WRITTEN FIRST.** The first unroll attempt reported `ok=true,
refusals=0` on Clouds and read as finished. It was not: all 21 layer plots had
folded to `0 / 0` — `na` — because no slot was ever written. **"Zero refusals" was
true and worthless.** So the acceptance is not the verdict, it is the CONTENT: a
layer plot must resolve to a tree that still mentions the smoother it interpolates
between (`/ema|sma/i` across 23 formulas — two MA plots plus twenty-one layers),
and the 21 layers must be DISTINCT, or the loop ran once and the substitution never
varied.

⛔ **A test written after the fix would have been shaped by whatever the fix
produced.** `it.fails` makes the inversion mechanical rather than a promise: each
case passes BECAUSE it fails, visibly in the reporter rather than hidden by a skip,
and goes RED the day the slots are filled — which is the day the marker is deleted.

## a3 — THE OUTCOME, AND THE TWO BUGS THE ACCEPTANCE FOUND

**Clouds unrolls.** Both lanes: `ok=true`, **0 refusals**, the `pine:block` note at
59 gone, 23 outputs of which 21 are the layer plots, **0 folding to `na`**, all 23
mentioning the smoother. Layer 0 reads:

```
ema(close, 9) + (ema(close, 20) - ema(close, 9)) * (0 / (21 - 1))
```

### Bug 1 — the two tree languages, four letters apart

`substConst` spliced `{type:'num'}` into a **parse** tree, and `resolve`'s switch
has `case 'number'` with no `case 'num'`. Every index fell off the end of that
switch, threw `pine:statement`, was swallowed by the fold's catch, and returned
`idx=null` — so no slot was ever written while the translation reported `ok, 0
refusals`. ⭐ **The probe printed `arg0type=num` — the type the substituter had
just written.** An instrument reading back its own substitution says nothing about
the language on the other side of the call.

### Bug 2 — `size` was read before the unroll, so `push` was invisible

`resolveVectorRead` captured `size = vec.slots.length` **above** `applyUnrolls`, so
an unrolled `array.push` grew the vector after the range check had already run.
Every read of `array.new<float>(0)` + push-in-a-loop refused with *"holds 0 slots
and this reads index 0"* — true of the creation, wrong about the array. ⛔ **That
is the corpus's DOMINANT idiom** (a1.4: median creation size **0**), and `set` was
immune because its slots already existed — so the bug was invisible on Clouds and
on every fixture written from it. Found by a control added while re-pointing a
rail, not by the acceptance.

### The acceptance condition, measured rather than assumed

The ruling was: *the 21 `pine:collection` refusals clear and the next refusal names
`color.t` at line 90*. The first half holds exactly. **The second half does not
fire, and the reason is already on file:** `color.t` at 90 binds
`bullUserTransparency`, which no output path ever reads, so the binding lives only
in `env` and is never resolved. That is the **env-only-binding class** — the named
a2/a3 follow-on (`bindingsAreVisible.test.js`), and the closing pass over `env` is
exactly what will make line 90 speak. Clouds' remaining 20 notes are `fill` at
118–137, carried as `pine:chart-only`, not refused.

### Two fixtures were spent, and moved rather than weakened

`vectorSilentNa` filled its array with `for i = 0 to 3` — which a3 made readable —
and `bothLanesAreTwoLanes` used Clouds as the script the lanes disagree on, which
a3 made them agree on. Both moved to the frontier (`while`, per F4) with their
assertions untouched, and both gained the opposite case so the pair discriminates
instead of agreeing with itself.

### Corpus movement

`corpus_metric.json`: **no verdict changed** — 266 scripts, host 31, screener 44,
all as before. Two scripts changed their guard LIST (one drops `pine:collection`
from both lanes; one now reaches it later). `lookback_agreement.json`:
`distinct_trees_walked` **288 → 310** — the 22 newly-unrolled trees agree between
both lookback authorities.

## CHECK 1 — DO CLOUDS' COLOURS DEPEND ON `color.t`? **NO, AND THE REASON MATTERS**

The worry was a silent rendering difference: a layer emitted without its alpha,
drawing opaque clouds where the author drew translucent ones. Measured on the
shipped door, both lanes:

```
OUT[2]  handle="p1"   presentation={}  hidden=true  hiddenReason="author"
OUT[22] handle="p21"  presentation={}  hidden=true  hiddenReason="author"
```

⭐ **The 21 layer plots carry no colour argument at all.** The author wrote
`plot(array.get(layerArray, k), display=display.none, editable=false)` — they are
invisible anchors, and the engine honours that (`hidden`, `hiddenReason:"author"`)
while keeping each handle `p1`…`p21` so a band reader can still join them. There
is no `droppedProps` key on an output; nothing is being dropped quietly.

`bullUserTransparency` (`color.t`, 90–91) and `transparencyStep` (97) feed only
`getBullFillColor`/`getBearFillColor`, and those are consumed only by `fill(...)`
at 118–137 — carried as 20 `pine:chart-only` notes, each with its line.

⛔ **So the colour fold is not what Clouds is missing. The FILL layer is.** The
entire visible artifact of this script is the twenty fills; with a3 landed the
pane draws two MAs and twenty-one correctly-hidden anchors — the author's script
minus the clouds. That is the drawing layer's entry, and it is named here rather
than fixed, because a colour fold would not move it by one pixel.

### …but the class is real elsewhere: **56 of 328 scripts feed a colour helper to `plot()`**

`tools/pine_colour_census.py` (own stripper, own control) over `corpus/committed`
+ `pine_oos` + the member scripts:

| | |
|---|---|
| files scanned | **328** |
| use `color.new` / `color.t` / `color.rgb` / `color.from_gradient` at all | **234** |
| helper inside a **`plot()`** call | **56** |
| helper inside `fill`/`bgcolor`/`barcolor`/`plotshape`/… | **85** |

And on those 56 the alpha **is** silently dropped today. `atr-bands__ad60b125e6`:

```
src  plot(showTPBands ? scaledTPLong : na,  …, color=color.rgb(255, 255, 255, 80), linewidth=1)
out  presentation={"color":"#FFFFFF","width":1}          ← the 80 is gone

src  plot(showTPBands ? scaledTPShort : na, …, color=color.rgb(255, 255, 0, 80), linewidth=1)
out  presentation={"color":"#FFFF00","width":1}          ← likewise
```

⭐ The engine folds the colour and discards the transparency argument, so a band
the author drew at 80% transparent renders fully opaque. **That is exactly the
silent difference the check was looking for — on a different 56 scripts.**

⛔ **NOT IMPLEMENTED HERE.** The ruling made the colour fold conditional on check
1, and check 1 is negative for Clouds. This is recorded as a finding for the owner
to rule on rather than scope taken unasked; a plan-time colour fold with alpha
preserved is a contained piece of work, and it does not drag `fill`/`bgcolor`
semantics with it.
