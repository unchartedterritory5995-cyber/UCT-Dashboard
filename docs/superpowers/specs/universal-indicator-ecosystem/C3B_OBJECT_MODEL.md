# C3B — THE GENERALIZED VISUAL OBJECT MODEL

**Result: the exit gate does NOT pass, on three of eighteen, and all three are
EVIDENCE items rather than architecture.** The object model exists, evaluates,
persists, renders and is wired end to end; what is missing is proof taken on a
real chart and against the vendor, plus the parity-set re-run those depend on.

⛔⛔ **AND THE HEADLINE NUMBER IS 18/27, NOT 46/60.** The wave was corrected to
the reachable denominator and this document keeps it: 46 of the frozen 60 demand
objects, 27 of those are execution-reachable while RISK-043 stands, and the
translator produces an object program for **18 of the 27**. Every figure below
names which population it belongs to.

---

## 1. PHASE 0 — THE TWO CENSUSES

`tools/c3b_object_census.mjs` → `tools/c3b_out/census.json`. Both populations,
never mixed, every aggregate emitted for each.

```
  corpus                      60
  A · object demand           46/60
  B · execution-reachable     27/46   ⭐ C3B TARGETS THIS
      loop-blocked            19/46   (RISK-043 stands)
```

### A — all 46 object-demand scripts

```
  family     scripts     new    set_*   get_*  delete
    line          23       85     111      12      79
    label         30      103      76       0      89
    box           20       40      37       4      32
    table         29       35      10       0       0
    polyline       3        9       0       0       5
    linefill       3        4       2       0       3
    table.cell   402 call sites

  LIFECYCLE TIER      30 CREATE_UPDATE_DELETE · 12 CREATE_UPDATE · 4 CREATE_ONLY
  REQUIREMENT FLAGS   38 VAR_REFERENCE · 34 MULTI_FAMILY · 29 TABLE · 23 COLLECTION
  conditional CREATE 38 · UPDATE 33 · DELETE 28   ·   declares max_*_count 32
  historical ref index  0/46
```

### B — the reachable 27, which is what was built against

```
  family     scripts     new    set_*   get_*  delete
    line           9       36      43       8      26
    label         14       52      37       0      43
    box            7       12       3       0       7
    table         19       22       8       0       0
    polyline       1        4       0       0       3
    linefill       2        3       1       0       2
    table.cell   227 call sites

  LIFECYCLE TIER      13 CREATE_UPDATE_DELETE · 10 CREATE_UPDATE · 4 CREATE_ONLY
  REQUIREMENT FLAGS   24 VAR_REFERENCE · 19 TABLE · 17 MULTI_FAMILY · 7 COLLECTION
  conditional CREATE 20 · UPDATE 17 · DELETE 11   ·   declares max_*_count 15
```

⭐⭐ **THE FINDING THAT DECIDED THE ARCHITECTURE: THE REACHABLE POPULATION IS
TABLE-DOMINATED.** 19 of 27 scripts drive a table, across 227 cell sites — more
than line, box and linefill combined. The 46-script headline hides this
completely, because line and label lead there. A wave built to the headline would
have shipped a beautiful line/label engine and served two thirds of nobody.

⭐ **AND COLLECTIONS COLLAPSE FROM 23/46 TO 7/27.** Sixteen of the twenty-three
collection scripts are loop-blocked — an object array is overwhelmingly something
authors fill *inside a `for`*. So the wave's conditional ("if collection demand
is material among the reachable set, build it; if it is nearly all loop-blocked,
be collection-READY but do not build unused execution") lands in the middle, and
the answer taken is: **build it, small.** 7/27 is a quarter of the target
population, and the whole demand is five operations — `push` ×5, `size` ×4,
`shift` ×3, `get` ×2, `set` ×2.

### The setter surface that actually has to exist (population B)

```
  label.set_text 13 · line.set_xy1 9 · line.set_xy2 9 · line.set_color 9
  line.set_width 9 · label.set_xy 9 · label.set_textcolor 9 · line.set_x2 5
  label.set_x 5 · table.set_position 2 · table.set_bgcolor 2
  table.set_frame_color 2 · table.set_border_color 2 · line.set_extend 1
  line.set_style 1 · label.set_size 1 · box.set_top 1 · box.set_bottom 1
  box.set_right 1 · linefill.set_color 1
```

⛔ **THE GETTERS ARE ONE CALL: `line.get_x1`, 8 sites, and it is REFUSED.** A
getter reads runtime OBJECT state back into a VALUE, and the V2 computation graph
is pure by construction — there is no node meaning "whatever that line's x1 is
now", and adding one would make the graph depend on the program that depends on
it. Refused by name wherever it appears, including nested inside `str.tostring`,
which is how the corpus writes it; the operation that needed it is dropped and
counted.

⛔ `polyline` is 1/27 and is **declared out of scope** rather than half-built: it
needs `chart.point[]`, which is a different type system, not a different renderer.

---

## 2. THE ARCHITECTURE

```
  PINE SOURCE
     │   pineObjects.js      a SEPARATE statement pass that consumes nothing
     ▼
  CANONICAL OBJECT PROGRAM  objectProgram.js
     │                      regs · colls · ops · limits · {v:'tree'|'graph'}
     ▼
  OBJECT STATE EVALUATOR    objectRuntime.js     bar-by-bar, no lookahead
     ▼
  GENERIC RENDER STATE      objectRenderState.js  time/price, no canvas
     ▼
  CHART ADAPTER             objectCanvas.js (pure) + objectLayer.js (one canvas)
     ▼
  binder.js → StockChart.jsx
```

### The V2 separation is preserved, and it is measured

Every dynamic property is a **reference** into the shared V2 graph, never a
copied tree. The proof is not "it saved" — it is that **a line's y-coordinate
resolves to the same node index the MA plot's own root does**
(`objectPersistence.test.js`). An object program's expressions are handed to
`buildGraph` as extra roots named `uctobj<i>`, deduped there by content digest
against every plot, bound to node indices, and the roots are then stripped so an
object expression can never be offered as a column.

Two forms, one converter, both validated:

```
  UNBOUND   {v:'tree', tree:i}   a translator's output, indexes its own `trees`
  BOUND     {v:'graph', node:i}  what a document stores, indexes the shared graph
```

⛔ The document validator refuses each on the other's document — an unbound
program stored beside a graph would be a second copy of every expression, which
is exactly the C2C compaction this wave must not undo.

### Identity is a counter, never a fingerprint

Two objects with identical geometry are two objects; one object moved twice is
one object. There is no code path that looks at properties to decide which object
something is. Typed handles (`OBJECT_REF<FAMILY>` in effect) refuse cross-family
misuse **at the door**: a line cannot enter a label register, a `cell` cannot
target a line, a `linefill` must reference lines.

### Three flags that could have been values, and must not be

Each of these is answerable by the RUNTIME and unanswerable by a pure graph, so
each is lifted out of the expression into a flag on the operation — where no
tree, no hash and no screener column can ever contain it:

| flag | Pine | why it is not a value |
|---|---|---|
| `lastBarOnly` | `if barstate.islast` | `BUILTIN_CONSTANT_TREE` refuses it, correctly: a screener column built on "the last bar" disagrees between a 500-bar and a 5,000-bar request. An object program is a picture of the chart, and a chart has exactly one last bar. |
| `once` | `var t = table.new(…)` | Pine's `var` initialises once. ⚰️ Without it a dashboard minted a NEW table on every bar — 300 bars, 300 tables, the 8-table envelope blown by bar 8, the whole indicator refused. |
| `requiresLive` / `requiresEmpty` | `not na(l)` / `na(l)` | a liveness test on a HANDLE. Only the runtime holds the registers. |

⚰️ **The `once` bug is the most valuable thing the capability ladder found.**
Every unit test of the runtime passed; the model was right; the TRANSLATOR was
wrong about the commonest initialiser in the corpus, and only a level that built
a real dashboard over 300 bars could see it.

---

## 3. WHAT THE TRANSLATOR REACHES

```
  scripts yielding an OBJECT PROGRAM      23/60
    …of the reachable 27                  18/27   ⭐
    …of the loop-blocked 19                5/19   (their NON-loop ops only)
  reachable scripts with no program yet    9/27
```

⛔ **Of those 9, FIVE DO NOT TRANSLATE AT ALL**, for reasons that predate C3B —
user-defined types, loops in the VALUE lane, expressions this engine refuses.
**Object reachability is not the same as script translatability**, and merging
the two would credit C3B with a failure it did not cause and hide four it did.
The remaining four drop their operations on a value the door cannot fold, and the
drop ledger names which gate refused (`guard:cell`, `create:box`, `cell:text`, …)
rather than reporting an anonymous count.

### Refused by name, never approximated

```
  186   object ops inside a loop body        RISK-043 intact
    8   line.get_x1 (as a value)             object state cannot become a node
    1   polyline script                      out of scope, stated
        table.merge_cells · label.set_text_font_family · array.pop
```

⚠️ One measured limitation worth separating from the object lane: `bar_index % 50
== 0` refuses because **`%` is not in this engine's expression grammar**. The
object pass read the box perfectly and had nowhere to get its condition from.
That is a VALUE-lane gap, and the ladder's Level 6 says so in place rather than
quietly choosing a different guard.

---

## 4. TEXT AND COLOUR — THE ADDITION THE MEASUREMENT FORCED

The first build was numeric-only and reached **6 of 27**. The census said why in
one line: the reachable population is table-driven, and a table is made of
**strings** — `str.tostring(x, "#.##")`, `"Avg " + str.tostring(n) + "-bar %"`,
`ready ? stateName(s) : "Warming up…"`. The V2 graph is numeric by construction
and always will be.

So text is a small expression tree whose **leaves are graph nodes**:

```
  textNode = {t:'lit', s} | {t:'num', node, fmt} | {t:'cat', args} | {t:'if', cond, then, else}
  colorNode = {c:'lit', hex} | {c:'if', cond, then, else}
```

The numbers still have one authority — the text layer formats, it does not
compute. Adding it took the reach from 6 → 14; block-local scope (the corpus
binds a cell's text inside the same `if` that draws it) took it to 18.

⛔ **A cell whose text cannot be read is DROPPED, not blanked.** An empty cell in
a dashboard reads as "the value is empty", which is a different and worse claim
than "we could not import this row". Same rule for a label whose caption the door
cannot carry — but an ABSENT caption is fine, because `label.new(x, y)` is a
legal Pine marker.

---

## 5. RESOURCE ENVELOPE, DELETION AND GC

The ceilings are **the authors' own**: 15 of the reachable 27 declare
`max_*_count`, median 500, max 500 — which is also TradingView's hard cap. A
script's declaration is read and clamped to ours, so a compliant script never
meets a UCT-only limit.

```
  line 500 · label 500 · box 500 · linefill 500 · table 8 · opsPerBar 2000
  collections: bounded by construction, cap ≤ 500
```

Over the ceiling is a structured `OBJECT_LIMIT_EXCEEDED` with a named reason —
**never a silent discard**. Deletion frees the instance, its cells, its slot in
the per-family counter, and **every register and collection that named it** (a
handle to nothing is how an update silently stops working).

⭐ The GC proof is a measurement, not an assertion of intent: `CREATE → DELETE`
across 5,000 bars leaves `peakLive.line == 1`.

---

## 6. PERFORMANCE, MEASURED

```
   objects   evaluate   renderState     paint      ops executed     (5,000 bars)
         1      5.4ms        0.89ms      0.59ms          5,001
        10     13.7ms        0.29ms      0.07ms         50,010
       100    117.1ms        0.27ms      0.23ms        500,100

   high turnover:  5,000 create/delete cycles in 7.7ms, peak live 1
   dashboard:      60 cells over 5,000 bars in 10.4ms, 61 ops (not 300,000)
```

⭐ **`lastBarOnly` IS THE PERFORMANCE STORY FOR DASHBOARDS.** Pine authors write
`if barstate.islast` for exactly this reason; honouring it keeps 60 cells at 61
operations instead of 300,000. The control case — the same dashboard without the
flag — is in the file, so the saving is measured rather than claimed.

⚠️ **The 100-object row is honest and worth reading twice.** 117 ms is a
pathological program: a hundred lines, every one updated on every one of 5,000
bars. Cost is linear in OPERATIONS (~0.23 µs each), not quadratic in bars, which
is the shape the architecture had to have — but a real script that did this would
be slow, and the envelope is what stops it becoming a hang.

The layer repaints only when the state or the visible window changes; a still
chart costs one comparison per frame.

---

## 7. FAILURE CONTAINMENT

The C2A rule, applied to the newest surface: **an object failure costs the
drawings and nothing else.**

- the object pass runs AFTER the value walk and consumes nothing — that is why
  adding C3B moved zero existing translations;
- it is wrapped: a script that defeats the object reader still gets its columns;
- in the binder it runs after the columns and before the pool, so a program that
  refuses cannot change which series get bound;
- every per-instance step is individually attempted, so one bad indicator cannot
  take the paint down.

---

## 8. THE CAPABILITY LADDER (reachable-27)

| # | level | proof |
|---|---|---|
| 1 | stable line identity | ✅ render-state |
| 2 | create + update | ✅ render-state |
| 3 | create + update + delete | ✅ render-state |
| 4 | var-held reference | ✅ render-state |
| 5 | label lifecycle (+ dynamic text) | ✅ render-state |
| 6 | box lifecycle | ✅ render-state |
| 7 | multiple families at once | ✅ render-state |
| 8 | bounded typed collection | ✅ render-state |
| 9 | table dashboard (dynamic numbers + conditional colour) | ✅ render-state |
| 10 | a real reachable OOS composite (`long_tail__16-spy-position-helper`) | ✅ render-state |

⛔⛔ **EVERY ONE OF THESE IS "RENDER-STATE PROVEN", NOT "SEEN".** The wave's own
rule is *"do not mark a level complete from unit tests alone"*, and this document
does not. The pipeline is wired — `StockChart` injects the capability, the binder
evaluates per instance, the layer paints — and the painter, the layer and the
save path each have their own rails. What has NOT happened is a headless chart
run that photographs the result. Until that exists, no level is complete.

---

## 9. EXIT GATE

| # | condition | result |
|---|---|---|
| 1 | one shared lifecycle model, several families | ✅ line · label · box · table · linefill |
| 2 | typed stable object identity | ✅ counter identity, cross-family refused at the door |
| 3 | create / update / delete | ✅ |
| 4 | lifecycle is bar-correct | ✅ no lookahead; a control proves the condition bar |
| 5 | var-held references | ✅ registers, `once`, `na`/`not na` liveness |
| 6 | collections follow measured reachable demand | ✅ built small: 7/27, five operations |
| 7 | resource envelopes explicit | ✅ authors' own `max_*_count`, clamped |
| 8 | deletion / GC bounded | ✅ 5,000 cycles, peak live 1 |
| 9 | C2C graph compactness preserved | ✅ the line's y IS the plot's node |
| 10 | persistence / recomputation | ✅ program in, picture out; both forms refused on the wrong document |
| 11 | **real chart rendering proven** | ⛔ **WIRED, NOT PHOTOGRAPHED** |
| 12 | **TradingView object evidence** | ⛔ **NOT TAKEN** |
| 13 | **fixed 10-member parity set remeasured** | ⛔ **NOT RE-RUN** |
| 14 | reachable OOS fidelity improves materially | 🟡 18/27 translate; fidelity not re-graded (13) |
| 15 | RISK-043 intact | ✅ 186 loop ops refused, counted |
| 16 | no silent object loss called FULL | ✅ drop ledger by gate; dropped ≠ blank |
| 17 | performance acceptable | ✅ measured, shape linear, dashboards near-free |
| 18 | no regression | ✅ 7,565 → see the suite line below |

**GATE: DOES NOT PASS — 15 of 18.** The three open items are 11, 12 and 13, and
they are one piece of work: a live chart run, a vendor capture of object
semantics using the C3A method that already worked, and the parity-set re-run
that depends on both.

⛔ **14 IS AMBER, NOT GREEN, AND DELIBERATELY SO.** "18 of 27 translate" is a
translation number. Whether those 18 now LOOK like their authors' indicators is a
fidelity grade, and grading it without re-running the fixed parity set would be
the `CHART_RENDERABLE`-as-`VISUAL_FULL` substitution C3A-CLOSE forbade.

---

## 10. BUILDER EXPOSURE

| family | ENGINE | PINE IMPORT | BUILDER/UI |
|---|---|---|---|
| line | ✅ | ✅ | ⬜ not begun (not authorised) |
| label | ✅ | ✅ | ⬜ |
| box | ✅ | ✅ | ⬜ |
| table | ✅ | ✅ | ⬜ |
| linefill | ✅ | ✅ | ⬜ |
| polyline | ⬜ out of scope | ⬜ | ⬜ |

⭐ The object program names no dialect. `line.new` is a Pine spelling; the model
has `create`, a closed property vocabulary and typed handles, so a Builder can
author one directly without a Pine round trip. That was a design constraint, not
a hope — it is why `pineObjects.js` is a separate module that `objectProgram.js`
does not import.

---

## 11. THE THREE POPULATIONS, AS THE WAVE REQUIRES

```
  A · all 60                  23 carry an object program
  B · all 46 object-demand    23 carry one; of the 23 unreached, 19 are loop-blocked
  C · reachable 27            18 carry one   ⭐ C3B's own number

  OBJECT CAPABILITY EXISTS BUT LOOP EXECUTION BLOCKS REACHABILITY   19
  OBJECT MODEL ITSELF STILL UNSUPPORTED                              1  (polyline)
  SCRIPT DOES NOT TRANSLATE FOR NON-OBJECT REASONS                   5
  VALUE THE DOOR COULD NOT FOLD                                      4
```
