# C4 PHASE 1 — the measurement, the completion matrix, and the architecture decision

Branch `worktree-indicator-ecosystem`. Baseline HEAD at the start of this wave:
`f578eb81b` (C3B-CLOSE), clean, in sync with origin.

Read `ENDZONE_GAP_REGISTER.md` PART K and the scorecard's
"POST-C4-PHASE-1 UPDATE" beside this.

---

## 0. THE ONE-PARAGRAPH ANSWER

The columnar evaluator **cannot** terminate at full Pine transferability, and the
limit is not the walker — it is the **persisted representation**. The canonical
IR has eight node types (`num series op call offset tf sym tf_live`) and **all
eight are expressions**. There is no statement, no assignment, no block, no
scope, no loop. Bar-to-bar state exists only as a `recurrence` declared *in data*
against a closed-table builtin, and exactly **one** function declares it
(`accum`). A user program therefore has nowhere to put `var`, `:=`, a loop, an
array or a UDT — not "the interpreter refuses it", **the artifact cannot hold
it**. 65% of 159 real scripts demand exactly that. The answer is **B, in its
hybrid form**: one version-aware Pine front end lowering into two execution
lanes — the existing pure-dataflow graph (kept, and measured 2.7× faster than a
VM on the arithmetic it can express) and a new bounded bar-by-bar runtime for
everything imperative. **This requires owner authorization before Phase 2.**

---

## 1. FRESH HEAD MEASUREMENT (Step 1)

Layer A (`pine.oosBaseline.test.js` over `oosHarness.measureScript`) re-run at
HEAD on every corpus whose sources are in-repo.

| corpus | n | RAW | ASSISTED | REFUSED | INVALID | UNKNOWN | flagged |
|---|---|---|---|---|---|---|---|
| OOS-1 frozen | 60 | 18 | 0 | 42 | 0 | 0 | 17 |
| blind (historical) | 48 | 27 | 9 | 12 | 0 | 0 | 5 |
| community | 30 | 18 | 0 | 12 | 0 | 0 | 15 |
| parity set | 10 | 5 | 0 | 5 | 0 | 0 | 5 |
| curated Pine | 21 | 14 | 0 | 6 | 1 | 0 | 10 |

**⛔⛔ ACCEPTANCE HAS NOT MOVED SINCE POST-WAVE-A.** Every corpus returns the
number it returned eight commits ago. Wave B, C0R, C1, C2B/C/D, C3A and C3B —
presentation carriage, the shared canonical graph, the ×48 compaction, the
declarative visual primitives, the whole object model — moved **zero scripts**
across the acceptance line. That is not a criticism of those waves; each did what
it set out to do. It is the measurement that says where the wall is.

**⛔⛔ AND ACCEPTANCE IS NOT TRANSFER.** Of the 91 accepted scripts across the
five corpora, **52 (57%) carry at least one silent-false-success probe flag**:

| flag | accepted scripts |
|---|---|
| `P4_visuals_dropped` | 37 |
| `P1_P2_state_present_but_accepted` | 33 |
| `P5_output_shortfall` | 21 |
| `P3_request_present_but_accepted` | 14 |
| `P7_constant_column` | 11 |

⚠️ A flag is a **detection, not a verdict** — the protocol keeps adjudication
separate and this document does not promote any of them to SILENT_WRONG. But the
output shortfall is arithmetic, not judgement: **21 accepted scripts declare 246
visual calls and carry 168 — 78 lost.** One curated script declares 35 and
carries 20.

`FULL_SEMANTIC`, `FULL_VISUAL`, `FULL_JOURNEY`, `FULL_SCREENER`,
`OBJECT_REACHABLE/BLOCKED`, `LOOP_BLOCKED` and `DATA_BLOCKED` are **Layer C**
axes. Layer A cannot answer them and this wave did not run Layer C.
**They are reported as UNMEASURED, never estimated.**
⚠️ The **compatibility-8** cannot be re-measured at all: it is a Layer-C result
archive (`tests/fixtures/compat_harness/results/public_script/*.json`) whose
public-script sources are not in the repo.

### The blocker census at HEAD — 169 rows, 159 unique scripts

| primary blocker | scripts | | | primary blocker | scripts |
|---|---|---|---|---|---|
| `pine:function` | 19 | | | `pine:character` | 4 |
| `pine:builtin` | 14 | | | `pine:function-def` | 4 |
| `pine:reassign` | 10 | | | `pine:constant-only` | 1 |
| `pine:no-output` | 9 | | | `pine:role-order` | 1 |
| `pine:tuple` | 6 | | | `pine:undefined` | 1 |
| `pine:state` | 6 | | | `pine:window` / `collection` / `block` / `module` | 1 each |
| `pine:request` | 6 | | | `pine:plot-offset` / `declaration-strategy` | 1 each |

**User functions (`pine:function` + `function-def`) = 23 scripts. Mutable state
(`pine:reassign` + `pine:state`) = 16.** Together, 39 of 77 refusals.

---

## 2. THE DEMAND CENSUS — what real Pine actually uses (Step 2 foundation)

New instrument: `tools/c4_pine_surface_census.mjs`. A source-token census over
all five corpora — 169 rows, **159 unique scripts** — with a `--self-test` whose
expected counts are stated in the file, so a broken matcher fails loudly instead
of reporting a clean zero. (It earned that on its first run: the self-test caught
the *author*, not the matcher.)

**Versions:** v6 110 · v3 13 · v5 12 · v4 9 · v2 2 · none 13.
**Declarations:** indicator 118 · study 35 · none 5 · strategy 1.

⚠️ **v6 is 69% of the corpus and `study()`-era scripts are 22%** — a version-aware
front end is not optional, and "target v5/v6" understates the real tail.

### Demand for semantics the columnar model cannot express

| family | scripts | share |
|---|---|---|
| mutable state (`var` / `:=`) | 80 | **50%** |
| `if` / `switch` blocks | 72 | 45% |
| user-defined functions | 64 | 40% |
| loops (`for` / `for…in` / `while`) | 45 | 28% |
| collections (array / matrix / map) | 42 | 26% |
| tuples | 42 | 26% |
| user-defined types | 11 | 7% |
| **ANY of the above** | **104** | **65%** |
| **NONE of the above (pure expression)** | **55** | **35%** |

⚠️ `state:varip` is the one zero-demand family — reported separately, matcher
suspected first per `lesson_a_saturated_instrument_reports_zero`; it is a genuine
absence (varip is rare outside realtime strategies).

### The cross-tab that settles the architecture question

| | ACCEPTED | refused |
|---|---|---|
| demands imperative Pine | **44** | 60 |
| pure expression only | 42 | 13 |

Two readings, both load-bearing:

1. **The columnar engine's ceiling is the 55 pure-expression scripts (35%).** It
   already accepts 42 of them; 13 more are lost to builtin coverage, no-output
   and the lexer — genuinely fixable inside Option A. **That is the whole prize
   available under A: about 13 scripts, and then it stops.**
2. **44 accepted scripts demand imperative Pine.** They were accepted because the
   engine kept the fragment it could fold and walked past the rest. This is the
   same population as the 33 `P1_P2` flags — and it is why "91 accepted" and
   "91 transferred" are different sentences.

### Feature combinations (Section 22/46) — measured, not assumed

`object+state` 56 (35%) · `udf+state` 56 (35%) · `loop+state` 45 (28%) ·
`array+object` 38 (24%) · `array+loop` 37 (23%) · `udf+loop` 37 (23%) ·
`object+loop` 37 (23%) · `udf+array` 36 (23%) · `udf+tuple` 26 (16%) ·
`mtf+state` 20 (13%) · `mtf+udf` 18 (11%) ·
**`array+loop+udf+object` together: 30 scripts (19%)**.

⭐ Nearly a fifth of real scripts need all four families **at once**. A roadmap
that ships them one at a time delivers nothing until the last one lands.

---

## 3. THE ARCHITECTURE FINDING — proved, not argued (Steps 3–4)

### 3.1 Why the current evaluator is insufficient

`interpret.js`'s own header, line 36:

> **⭐ COLUMNAR, NOT PER-BAR.** Every function in the table is a whole-series
> reduction, so the walker evaluates each node ONCE into a column and combines
> columns. That is both faster and the only shape in which `maxLookback` is a
> TREE SUM rather than a dataflow analysis.

That is a deliberate, well-reasoned design with a real safety dividend. It is
also the ceiling.

**⛔⛔ AND THE CEILING IS IN THE ARTIFACT, NOT THE WALKER.** `parse.js:171`:

```js
export const NODE_TYPES = Object.freeze(
  ['num', 'series', 'op', 'call', 'offset', 'tf', 'sym', 'tf_live'])
```

Eight types, **all expressions**. `api/services/ast_interpret.py:112` pins the
same eight, and `graph.js` validates every V2 node against the same
`CANONICAL_KEYS` and throws on anything else. So a statement, an assignment, a
block, a loop body, a scope frame, an array or a UDT instance has **nowhere to be
written down** — not in the tree, not in the graph, not in a saved definition.

Bar-to-bar state exists, and the table says exactly how much: the comment beside
`NODE_TYPES` reads *"BAR-TO-BAR STATE ADDED NO NODE TYPE, AND THAT WAS THE
POINT"* — `accum` is a `call` whose seed, body and self-binding are declared in
`closedTable.json`. **Exactly one of 70 functions declares a recurrence.** The
per-bar loop that runs it is real but sealed inside that one call, and its own
refusal states the boundary: *"a running value reads its own past only inside its
own update, and only through operators and pointwise calls."*

**Answer to §74.1/74.2:** insufficient, and the families that cannot fit are
`var`/`varip`/`:=`, general recurrence, loops of every form, arrays and maps,
UDTs, UDF-local persistent state, loop-driven object lifecycle, and the
history-dependent builtins that are stateful by definition (`valuewhen`,
`barssince`, `cum`). Extending the columnar model far enough to hold them *is*
building a bar-by-bar runtime — Option A taken to its conclusion **becomes**
Option B, with a worse migration story because it would arrive as accreted
special cases rather than a designed one.

### 3.2 What a runtime would cost — MEASURED, and it inverts the intuition

New instrument: `tools/c4_vm_feasibility_probe.mjs`. Four execution shapes run
**the same program** over the same synthetic bars, with an agreement control that
must pass to 1e-9 **before any timing is printed** (it fired on the first draft —
the columnar shape was running a different op sequence, and the timings would
have been meaningless).

5,000 bars, 120 ops/bar, median of 7:

| shape | median | vs columnar (reused) |
|---|---|---|
| columnar, allocating per node (what the engine does today) | 2.08 ms | 0.66× |
| **columnar, reused buffers (the fair upper bound)** | **0.49 ms** | 1.00× |
| bar-by-bar **tree walk** | 2.44 ms | 4.96× |
| bar-by-bar **bytecode** | 1.37 ms | **2.78×** |

At 500 ops/bar: bytecode 2.66×, tree walk 6.06×.

**Three conclusions, and one of them corrects an intuition this program has been
carrying:**

1. **A per-bar VM is ~2.7× slower than an optimally-written columnar pass** on
   arithmetic the columnar pass can express. That is the honest number, and it is
   the argument for keeping the dataflow lane rather than replacing it.
   ⚰️ Measured against the *allocating* columnar shape the VM looks **faster**
   (0.66×) — that reading is an artefact of allocation, and it is why the
   reused-buffer control exists.
2. **A flat bytecode loop is the shape; an AST walk is not.** 2.78× vs 4.96–6.06×
   is the whole difference between a runtime that is affordable and one that is
   not, for the same semantics.
3. **The absolute cost is small enough that the performance objection to a VM
   does not survive contact with a number.** 274 ns/bar at 120 ops/bar
   (2.3 ns/instruction). Extrapolated to whole-market screening, single-threaded:

   | scan | 120 ops/bar | 500 ops/bar |
   |---|---|---|
   | 5,000 symbols × 300 bars | **0.4 s** | 1.4 s |
   | 5,000 × 500 | 0.7 s | 2.3 s |
   | 8,000 × 300 | 0.7 s | 2.2 s |

   ⚠️ **This is a floor.** It excludes na-handling, bounds checks, ring-buffer
   history reads, scope allocation, array ops and object emission. Treat it as
   "the dispatch loop is not the problem", never as a budget.

### 3.3 THE DECISION

**Option B, in the hybrid form of §66 — and the hybrid is not a hedge, it is what
the two measurements jointly say.** 35% of scripts are pure expressions the
existing lane serves 2.7× faster and already serves with cross-kernel numerical
agreement to 1e-9; 65% need semantics no expression tree can hold.

```
              PINE SOURCE (version-aware)
                        │
              ┌─────────▼─────────┐
              │  ONE FRONT END    │  lex · parse · semantic analysis ·
              │  (version-aware)  │  typed IR · resource estimation
              └────┬─────────┬────┘
                   │         │
      pure / stateless   imperative / stateful
                   │         │
      ┌────────────▼──┐   ┌──▼──────────────────────┐
      │ V2 GRAPH      │   │ BOUNDED BAR-BY-BAR      │
      │ columnar      │   │ RUNTIME (flat IR)       │
      │ (KEPT AS IS)  │   │ scopes · state · loops  │
      │               │   │ arrays · UDF frames     │
      └────────┬──────┘   └──────────┬──────────────┘
               └────────┬────────────┘
                        ▼
        output series · presentation program · OBJECT PROGRAM (C3B, kept)
                        ▼
                  CHART · SCREENER
```

**⛔ The hybrid's one hard requirement is a differential rail:** an expression
evaluated in the graph lane and the same expression executed in the VM must agree
to 1e-9, per bar, or the hybrid has silently become two languages. That rail is
Phase 2 Task 1, before any capability lands.

---

## 4. WHAT SURVIVES, WHAT ADAPTS, WHAT RETIRES (Step 6)

| subsystem | verdict |
|---|---|
| **V2 canonical graph** (`graph.js`, ×48 compaction) | **SURVIVES UNCHANGED** as the pure-expression lane + persistence form. Its node vocabulary is exactly right for what it holds. |
| **`interpret.js`** (JS columnar) | **SURVIVES** as the graph lane's evaluator. It is the faster path and it is verified. |
| **`ast_interpret.py`** (Python columnar) | **SURVIVES** for the pure lane. ⛔ It must NOT grow a second VM — see §5. |
| **`closedTable.json`** | **SURVIVES AND EXTENDS.** The closed-vocabulary decision is the security boundary and re-earns itself under a VM unchanged. |
| **Object program** (`objectProgram.js` + runtime + canvas, C3B) | **SURVIVES — and is the reason the VM is affordable.** It is dialect-neutral and takes `create/update/delete`; the VM emits those instead of anyone re-implementing line/label/box inside a renderer. |
| **Presentation program** (Wave B) | **SURVIVES.** Calculation/presentation separation is orthogonal to execution. |
| **Parameter identity / manifests** (Track F) | **SURVIVES.** Logical parameter ids are a front-end concept. |
| **Contentful-output + false-success rails** (Wave A) | **SURVIVES**, and must be re-run against VM output. |
| **Failure containment** (C2A) | **SURVIVES**, and needs one new distinction: PROGRAM vs OUTPUT vs PRESENTATION vs RESOURCE failure (§50). |
| **Vendor parity infrastructure** | **SURVIVES AND EXPANDS** — it is how VM state semantics get pinned. |
| **Refusal machinery** | **SURVIVES**, narrowing as capability lands. Two adjudicators called it the engine's best property; it stays the safety net during the transition. |
| `maxLookback` as a TREE SUM | **ADAPTS.** Valid for the graph lane; the VM lane needs a different bound (steps × bars, declared limits). Neither replaces the other. |
| Nothing | **RETIRES** in Phase 2. |

**Persistence / migration (§74.27–31, §51):** saved V1/V2 definitions are
expression documents and stay readable by the graph lane **byte-identically** —
this is an additive `kind` on the document, not a rewrite. A script needing the
VM produces a **new** program kind alongside; semantic hashes over graph
documents are unaffected because those documents do not change. Rollback = stop
emitting the new kind. **No destructive mass rewrite, and none is needed.**

---

## 5. THE TWO-KERNEL DECISION (§47) — the biggest open risk

Today: one parser, two walkers, 1e-9 agreement, deliberately non-numpy so
summation order matches. That is an achievement and it is why the screener and
the chart mean the same thing.

**⛔⛔ DO NOT IMPLEMENT A PINE VM TWICE.** Scopes, frames, loops, arrays, UDF
calling conventions and object lifecycle are the hardest semantics in this
program; two independent implementations would diverge, and the divergence would
be invisible exactly where it matters (a negative dividend, a loop's summation
order, a `var` initialised on a different bar).

Three candidates, to be decided **in Phase 2 Task 0**, not here:

- **(a) One JS runtime, screener calls it.** Reuses the whole implementation;
  costs a Node execution path in the screener's Python service.
- **(b) One runtime compiled to WASM, both lanes embed it.** Strongest semantic
  guarantee, highest build complexity, best sandbox story.
- **(c) Two implementations behind one conformance suite** — the status quo's
  shape. **Cheapest to start, and the one this document argues against**: it
  doubles the hardest surface in the program.

⚠️ This is the single largest engineering risk in Phase 2 and it is a decision
the owner should make deliberately, not one that should be defaulted into by
whoever writes the first line.

---

## 6. WHAT PHASE 1 IMPLEMENTED — and the number it did not move

Per §63, exactly one generalized low-risk fix, chosen because it is correct under
either architecture.

### H7 / J5.1 — `%` reaches the engine, as a call

Pine has always lexed `%` and given it precedence; the tree died at
`PINE_OP_TO_TABLE`. **The fix is three lines in `pine.js`: `%` lowers to
`cCall('mod', …)`.**

⭐ **The repair that was NOT made is the point.** Declaring `%` in
`closedTable.operators` + a precedence in `parse.js` + an implementation in
`interpret.js` + another in `ast_interpret.py` is four edits and a **second
authority over one arithmetic** — and `_guarded_mod`'s own docstring names the
trap it would have walked into: **`-7 % 2` is `-1` in JS and `1` in Python.** Two
borrowed `%` operators would have made the chart and the screener disagree about
every negative dividend, with every test green in both lanes, because each lane
would have been self-consistent. The table already owned this arithmetic
(truncated, sign follows the dividend, NaN on a zero divisor), verified in both
kernels. So the surface syntax lowers onto the settled semantics: **no new node
type, no precedence entry, no second implementation, and the screener understood
`%` the same day the chart did.**

Rail: `pine.modulo.test.js`, 10 cases, including the negative dividend that
distinguishes truncated from floored, and an assertion that
`closedTable.operators` still does **not** contain `%` — the absence *is* the fix.

⚰️ **AND IT FOUND AN ADJACENT DEFECT BY BEING WRONG.** The non-vacuity control
asserted that `close ^ 3` refuses with `pine:operator`. It does not: the **lexer**
rejects `^` first with *"Pine has no character like this one"* — about a character
Pine has. That is the same honesty defect OOS-2 booked against 4/60 real scripts
(`f(...).field` tripping the same guard). The test now records it truthfully and
goes red when the lexer guard is corrected.

### ⛔⛔ AND IT MOVED NOTHING. THIS IS THE FINDING.

Re-measured across all five corpora after the fix:

```
oos60 18→18 · blind48 36→36 · community30 18→18 · parity10 5→5 · curated21 14→14
TOTAL accepted 91 → 91
corpus-wide outputs 761 → 761 · usable 224 → 224
```

Eleven scripts (7%) demand `%`. **Five were already accepted; six are blocked by
something bigger** — `pine:tuple`, `pine:character`, `pine:no-output` ×2,
`pine:function-def`, `pine:builtin`. Not one script's fate changed, and **not one
additional output was carried.**

⭐⭐ **This is §64 demonstrated rather than argued.** A correct, generalized,
properly-railed value-lane grammar fix — one the directive itself named as a
Phase-1 candidate — bought exactly zero on 159 real scripts, because every `%` in
the corpus sits inside a construct the imperative lane blocks first. **The
remaining value-lane candidates (`last_bar_index`, the dropped `create:box`,
further operators) should be expected to buy near-zero too, and Phase 1
deliberately stopped rather than spend the wave proving it five more times.**

### What Phase 1 deliberately did NOT implement, and why

- **`last_bar_index` (H8/J5.2)** — the sole vendor divergence, but *not* safe
  under either architecture. "Last bar" is well-defined on a chart and undefined
  for a screener column, where it depends on the request size — the same reason
  `barstate.islast` is correctly refused there. C3B already lifted `lastBarOnly`
  out of the expression as a runtime flag for exactly this. Doing it properly
  means the lane-aware flag design, which belongs with the runtime.
- **`create:box` upstream drop (J5.1/I10)** — real defect, but its parity member
  is loop-blocked, so fixing it changes nothing observable until loops exist.
- **H10 / J5.4 disclosure** — per §58 and §12, deliberately deferred. The desired
  end state has nothing material to warn about; investing in "partial import
  feels finished" while core capability is missing is the wrong order.
- **Anything in the state/loop/array/UDF families** — §64. That machinery belongs
  in the runtime, and building it inside the columnar engine first is sunk cost by
  construction.

---

## 7. COMPLETION MATRIX — anchored to measured demand

Status vocabulary: ✅ implemented + verified · 🟡 partial (subfeatures missing) ·
🔴 unimplemented · ⬜ not measured. "Chart"/"Screener" mean verified on that
surface. **Demand** is scripts of 159.

### Language core

| family | demand | impl | chart | screener | vendor | notes |
|---|---|---|---|---|---|---|
| arithmetic ops `+ - * /` | ~all | ✅ | ✅ | ✅ | ✅ | 1e-9 cross-kernel |
| `%` modulo | 11 | ✅ | ✅ | ✅ | ⬜ | **THIS WAVE** — lowers to `mod` |
| comparison / boolean | ~all | ✅ | ✅ | ✅ | ✅ | |
| ternary `?:` | 152 | ✅ | ✅ | ✅ | ✅ | |
| `na` / `nz` | 99 | ✅ | ✅ | ✅ | 🟡 | |
| history `x[n]` | 119 | ✅ | ✅ | ✅ | ✅ | bounded lookback |
| unary `-` / `!` | ~all | ✅ | ✅ | ✅ | ✅ | |
| **operator census beyond these** | — | 🔴 | | | | Phase 2: full v5/v6 operator inventory |

### Statements, state, control flow — **the wall**

| family | demand | impl | notes |
|---|---|---|---|
| `if` / `else` blocks | 72 | 🔴 | no statement node exists |
| `switch` | 22 | 🔴 | |
| `var` declaration | 64 | 🔴 | `pine:state` |
| `varip` | 0 | 🔴 | no measured demand; still required for realtime completeness |
| `:=` reassignment | 72 | 🔴 | `pine:reassign` |
| general recurrence | — | 🔴 | 1 of 70 builtins (`accum`) declares one; users cannot |
| `for` | 41 | 🔴 | RISK-043 guard — correct today, not the end state |
| `for…in` | 5 | 🔴 | |
| `while` | 13 | 🔴 | |
| `break` / `continue` | 14 | 🔴 | |
| nested loops | ⬜ | 🔴 | not separately censused |
| loop-carried state | 45 | 🔴 | `loop+state` combination |

### Functions, tuples, types

| family | demand | impl | notes |
|---|---|---|---|
| UDF definition | 63 | 🔴 | 23 scripts blocked primary |
| UDF lexical binding | — | 🟡 | binding work proven; execution not |
| `method` | 2 | 🔴 | |
| tuple destructuring | 42 | 🔴 | `pine:tuple`, 6 primary |
| tuple return | 3 | 🔴 | |
| UDT (`type`) | 11 | 🔴 | |
| constructor `.new()` | 70 | 🟡 | dominated by object constructors, which C3B serves |

### Collections

| family | demand | impl | notes |
|---|---|---|---|
| `array.*` | 42 | 🔴 | 1,468 uses — the densest blocked family by call count |
| `array.new` | 40 | 🔴 | |
| `matrix.*` | 4 | 🔴 | |
| `map.*` | 1 | 🔴 | |
| arrays of objects | 38 | 🔴 | `array+object` |

### Context, timeframe, MTF

| family | demand | impl | notes |
|---|---|---|---|
| `bar_index` | 48 | ✅ | |
| `last_bar_index` | 2 | 🔴 | **H8** — lane-dependent, see §6 |
| `barstate.*` | 51 | 🟡 | `isconfirmed` folds to 1; `islast` refused for screener by design |
| `timeframe.*` | 32 | 🟡 | |
| `syminfo.*` | 51 | 🟡 | |
| session | 1 | 🟡 | |
| `request.security` | 28 | 🔴 | `pine:request`, 6 primary |
| `request.security_lower_tf` | 2 | 🔴 | |
| realtime / forming bar | — | 🔴 | engine evaluates closed bars only |

### Inputs (Track F)

| type | demand | impl | | type | demand | impl |
|---|---|---|---|---|---|---|
| `input.int` | 105 | ✅ | | `input.timeframe` | 14 | 🔴 |
| `input.float` | 61 | ✅ | | `input.session` | 8 | 🔴 |
| `input.bool` | 55 | ✅ | | `input.symbol` | 7 | 🔴 |
| `input.string` | 45 | 🔴 | | `input.time` | 2 | 🔴 |
| bare `input()` | 41 | 🟡 | | `input.price` | 1 | 🔴 |
| `input.color` | 38 | 🔴 | | `input.enum` | 1 | 🔴 |
| `input.source` | 15 | 🔴 | | | | |

⭐ **`input.string` at 45 scripts (28%) is the largest unserved input type** and
is usually a mode selector that decides which branch of the script runs — so it
is entangled with `switch`/`if`, not independent.

### Outputs, visuals, objects

| family | demand | impl | notes |
|---|---|---|---|
| `plot` | 119 | ✅ | |
| multi-output handback | — | 🔴 | still ONE output per Apply |
| `hline` / levels | 20 | ✅ | Wave B |
| overlay / pane | — | ✅ | Wave B, verified live |
| dynamic colour | 45 | 🟡 | `colorDynamic` 47 demanded-and-not-carried |
| `fill` | 34 | 🔴 | |
| `bgcolor` | 17 | 🔴 | |
| `barcolor` | 17 | 🔴 | |
| `plotshape` | 35 | 🟡 | vendor-confirmed marker semantics (C3A) |
| `plotchar` / `plotarrow` | 2 / 1 | 🟡 | |
| `plotcandle` / `plotbar` | 6 / 1 | 🔴 | passthrough rule only |
| `line` / `label` / `box` / `table` | 31/35/21/33 | ✅ | **C3B — painted, vendor-confirmed** |
| `polyline` / `linefill` | 3 / 2 | 🟡 | |
| object lifecycle create/update/delete | — | ✅ | vendor-confirmed identity + coords |
| **objects driven by loops/arrays/state** | 37 / 38 / 56 | 🔴 | **the object lane's real ceiling** |
| `alert` / `alertcondition` | 52 | 🔴 | |

### Screener projection

| family | impl | notes |
|---|---|---|
| boolean column | ✅ | |
| **numeric series column** | 🔴 | **§38 OPEN PRODUCT GAP** — 6/60 screenable-boolean at baseline |
| levels / thresholds / multi-output | 🔴 | |
| chart↔screener semantic parity | 🟡 | holds for the expression lane; undefined for a lane that does not exist yet |

### Journey

| stage | status |
|---|---|
| paste → compile → apply → render | ✅ for accepted scripts |
| save / close / reopen | ✅ (C3B: 9/9 objects repaint after reopen) |
| edit parameters → recompute | ✅ (C3B param probe, instance-scoped) |
| screen | 🟡 boolean only |
| duplicate / reuse | ⬜ |

---

## 8. PHASE 2 — the proposed order (owner review required before ANY of it)

**Task 0 — the two-kernel decision (§47).** Owner/architect call between (a) one
JS runtime the screener invokes, (b) one WASM runtime both embed, (c) two
implementations behind one conformance suite. Everything else depends on it.

**Task 1 — the differential rail, before any capability.** Pure expression in the
graph lane vs the same expression in the VM, per bar, 1e-9. Without it the hybrid
is two languages and nobody will notice the day they part.

**Task 2 — the runtime foundation.** Version-aware front end → typed IR → flat
bounded program. Bar loop, scope frames, ring-buffer history, explicit resource
model (§49: program size, IR nodes, instructions/bar, total instructions, loop
iterations, nesting, array elements, live objects, object ops, history, MTF
fanout, memory, wall time), structured failure on every limit.

**Task 3 — state.** `var`, `:=`, general recurrence, function-local persistence.
**80 scripts (50%).** Vendor-pin initialisation and first-bar behaviour.

**Task 4 — statements + control flow.** `if`/`else`/`switch` as real statements.
**72 scripts.** Unblocks `input.string` mode selectors as a side effect.

**Task 5 — UDFs + tuples.** **64 + 42 scripts**, and the biggest single primary
blocker at 23.

**Task 6 — loops.** **45 scripts.** RISK-043's guard comes down only when the
bounded runtime can execute the semantics correctly — never before.

**Task 7 — arrays and collections.** **42 scripts**, 1,468 uses.

**Task 8 — objects driven by state/loops/arrays.** Reconnects C3B to its supply;
this is where the 19 loop-blocked object scripts land, plus `create:box`.

**Task 9 — context + MTF.** `last_bar_index` with the lane distinction,
`barstate` completion, `request.security`. **28 scripts.**

**Task 10 — the remaining visual families.** fill, bgcolor, barcolor, plotcandle,
plotbar, dynamic colour carriage.

**Task 11 — numeric screener projection (§38).** Multi-output handback and
thresholdable numeric columns; the `trendScore > 80 AND buySignal` workflow.

**Task 12 — realtime / forming-bar semantics.** Historical-only is not full Pine.

**Task 13 — cross-feature conformance** across the eleven measured combinations,
then re-freeze and re-measure every corpus.

⚠️ Tasks 3–7 are one architectural unit in the corpus even though they are listed
separately: 30 scripts (19%) need array+loop+UDF+object simultaneously, so
per-task acceptance deltas will look flat until the block completes. **Judge them
by conformance coverage, not by corpus acceptance, until Task 8 lands** — the `%`
result in §6 is exactly what a mid-block measurement looks like.

---

## 9. TEST ACCOUNTING

Full chart suite at HEAD before this wave's changes:
**7,597 passed · 4 skipped · 12 failed of 7,613** (354 files: 346 pass, 8 fail), 277 s.
Of the 12: **3 documented pre-existing** (`BuilderSheet.pine` byte-identical
document · `ImportBox.thinkscript` whitespace · `flipCRecord` 52-vs-53) and
**9 load-timeout flakes** on filesystem-scanning rails with a 15 s limit that take
29–77 s under full-directory load — `EvidenceTab.doors`, `engineEnabledMigration`,
`enumerationSites`, `flipCGeometry`, `manifestProse`; **all five pass when run
alone**, verified individually on a quiet machine.

This wave adds `pine.modulo.test.js` — **10 passing**, including a negative-dividend
case and two non-vacuity controls.

⚠️ Process notes worth keeping: an invalid `--reporter` made a failing run report
exit 0 through the wrapper (only an explicit `REAL_EXIT` echo caught it), and a
first "isolated" re-run was contaminated by a prior vitest still winding down.

---

## 10. WHAT THIS WAVE DID NOT MEASURE — stated, not estimated

- **Layer C entirely**: chart-renderable, save/reopen, visual fidelity,
  full-journey and full-screener axes for the corpora. Reported UNMEASURED.
- **compatibility-8**: Layer-C archive; sources not in repo.
- **Vendor evidence**: none gathered this wave. The `%` truncation rule is taken
  from Pine's documented semantics and the table's existing `mod`, **not** from a
  vendor capture. Negative-dividend `%` should be vendor-pinned in Phase 2.
- **Adjudication** of the 52 probe-flagged accepted scripts. Flags are detections;
  no script was reclassified to SILENT_WRONG here.
- **Nested loops, alias/reference semantics, invalid-index semantics** and other
  fine-grained subfeatures: censused only at family level.
