# PINE LANGUAGE + RUNTIME COMPLETION MATRIX

As of C4 Phase P7.2 (UDF-local history). Branch `worktree-indicator-ecosystem`.

⭐⭐ **FIVE LEVELS, NOT ONE WORD (§52).** "LOOP: partial" tells an engineer
nothing about what is left. These columns do:

| column | question |
|---|---|
| **PARSE** | does the shared lexer + statement tree read it? |
| **SEM** | does the semantic front end RECOGNISE it as its own family? |
| **IR** | is there a semantic-IR shape that can hold it? |
| **RUN** | does the bar-by-bar runtime execute it? |
| **PROD** | is it reachable by a member in the shipped product? |

⛔ **`SEM ✅` WITH `IR ⬜` IS A REAL, VALUABLE STATE** and the point of 2D-2: the
front end identifies the construct, keeps its structure, and refuses it BY NAME at
the implementation boundary — so the later wave consumes an already-correct
semantic classification instead of re-cutting the front end.

⚠️ **`PROD` IS ALMOST ENTIRELY EMPTY ON PURPOSE.** The runtime lane is not wired
to the chart or the screener (§43/§44). Existing accepted scripts keep reaching
production through the untouched columnar path; the `PROD` column here describes
the RUNTIME lane, not the product overall.

---

## Language core

| family | PARSE | SEM | IR | RUN | PROD | notes |
|---|---|---|---|---|---|---|
| arithmetic `+ - * /` | ✅ | ✅ | ✅ | ✅ | ⬜ | operators IMPORTED from `interpret.js`, never copied |
| unary `-`, `not` | ✅ | ✅ | ✅ | ✅ | ⬜ | |
| comparison | ✅ | ✅ | ✅ | ✅ | ⬜ | `cmp` answers 0 on `na`, shared with the columnar lane |
| boolean `and`/`or` | ✅ | ✅ | ✅ | ✅ | ⬜ | `logical` propagates `na`, shared |
| ternary `?:` | ✅ | ✅ | ✅ | ✅ | ⬜ | both arms evaluate — an EFFECTFUL branch is a statement instead |
| `%` modulo | ✅ | ✅ | 🟡 | 🟡 | ✅ | pure lane only (lowers to `mod`); beside a mutable value it refuses `runtime:operator`. **VENDOR-PINNED 2026-09-08**: truncated, sign follows the dividend (`-7 % 2 = -1`) — Phase 1's documentation-only assumption confirmed |
| `na` | ✅ | ✅ | 🟡 | 🟡 | ✅ | NaN for floats today; the TAG model (`na(someLine)`) is designed, not built |
| history `x[n]` over a column | ✅ | ✅ | ✅ | ✅ | ⬜ | out of range is `na`, never a clamp |
| **history `x[n]` over a MUTABLE variable** | ✅ | ✅ | ✅ | ✅ | ⬜ | **2F-2A** — a committed ring per history-bearing slot, **VENDOR-PINNED v5+v6 2026-09-08**. Demand **35** scripts, first blocker 1. See the fine-grain table |

## State and control flow

| family | PARSE | SEM | IR | RUN | PROD | notes |
|---|---|---|---|---|---|---|
| ordinary local declaration | ✅ | ✅ | ✅ | ✅ | ⬜ | frame reset every bar — a local read before assignment is `na` |
| `var` declaration | ✅ | ✅ | ✅ | ✅ | ⬜ | initialiser JUMPED OVER once initialised |
| `var x = na` | ✅ | ✅ | ✅ | ✅ | ⬜ | initialisation tracked separately from value |
| `:=` reassignment | ✅ | ✅ | ✅ | ✅ | ⬜ | statement order observable |
| `if` / `else` as statements | ✅ | ✅ | ✅ | ✅ | ⬜ | mutation in either branch; nested |
| `else if` chains | ✅ | ✅ | ✅ | ✅ | ⬜ | **P7.4** — chain collected, arms lowered in source order, assembled as NESTED `IF`s. **RUNTIME-LANE evidence**: `elseIfChain.test.js`, 14 cases from Pine source |
| `na` does not take a branch | ✅ | ✅ | ✅ | ✅ | ⬜ | |
| block-local scope + shadowing | ✅ | ✅ | ✅ | ✅ | ⬜ | a slot per DECLARATION, never per name |
| `switch` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:switch` |
| `varip` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:varip` — intrabar, which a closed-bar runtime cannot reproduce |

⚰️⚰️ **THAT ROW READ `✅ ✅ ✅ ✅` FOR MONTHS AND WAS FALSE — THE LESSON OUTLIVES
THE FIX.** Until P7.4, `if / else` ran in the runtime lane and
`if / else if / else` refused `runtime:statement`, *"`else` with no `if`"*. The
cause was a one-element list: the `else if` arm was lowered by recursing with
`lowerStmts([synthetic], scope)`, so the nested `if` looked for its own `else` at
`list[i + 1]` of a list with ONE entry and every later arm stayed in the outer
list.

⛔⛔ **IT SURVIVED BECAUSE THE OTHER LANE CAN DO IT.** The shipped columnar door
handles chains correctly, so every spot check corroborated a claim about a front
end that could not. **From now on, a capability that exists in more than one
execution lane must carry evidence naming WHICH LANE was tested** — that rule is
this row's real legacy, and it is why the corrected row above cites a
runtime-lane test file by name.

⚠️ And a correction to the first version of this note: it said *two* corpus
scripts sat on `else if`. Only `pine/15-anchored-vwap` did.
`pine/10-supertrend`'s `runtime:statement` is at line 30 on a bare `longStop` —
BLOCK-AS-VALUE, a different gap (register Q6.4). Two refusals sharing a guard
name are not two instances of one cause; attributing each to its line is what
told them apart.

## Functions, tuples, collections, types

| family | PARSE | SEM | IR | RUN | PROD | notes |
|---|---|---|---|---|---|---|
| user-defined functions | ✅ | ✅ | ✅ | ✅ | ⬜ | **2E** — see the fine-grained table below |
| tuples / destructuring | ✅ | ✅ | 🟡 | ⬜ | ⬜ | `runtime:tuple`; `EXPR.TUPLE` declared |
| loops `for` / `while` | ✅ | ✅ | 🟡 | ⬜ | ⬜ | `runtime:loop`; `STMT.FOR`/`WHILE`/`BREAK`/`CONTINUE` declared |
| arrays / matrix / map | ✅ | ✅ | 🟡 | ⬜ | ⬜ | `runtime:array` — routed to the COLLECTION family, not `pine:builtin` |
| user-defined types | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:udt` |
| builtin calls (closed table, 70) | ✅ | ✅ | ✅ | ✅ | ✅ | via `READ_COLUMN` — evaluated once by the columnar lane |
| a **POINTWISE** builtin fed by state | ✅ | ✅ | ✅ | ✅ | ⬜ | **2F-1** — `EXPR.BUILTIN` → `OP.POINTWISE`, applied per bar. **14 → 0** across all five corpora |
| a **FINITE-WINDOW** builtin fed by state | ✅ | ✅ | ✅ | ✅ | ⬜ | **2F-2B** — `OP.WINDOW` reads `span` cells from the committed ring and calls `interpret.js`'s OWN reducer. 12 members. First blocker **11 → 8**, and every one of the 8 survivors is blocked on `ta.ema` |
| a **RECURRENT** builtin fed by state | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:call-windowed-state` — `ema`/`rma` carry their previous OUTPUT, which no window of inputs can supply. **This is now the whole of that guard's population** — **2F-2C** |
| an **UNDECLARED** builtin fed by state | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:call-undeclared-builtin-state` — 2 scripts. Blocked on the BUILTIN existing in the closed table, not on the runtime |
| a **TEXT** builtin fed by state | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:call-text-state` — 1 script. A value-model change; deferred by name (§22) |
| a **CONVERSION** fed by state | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:call-conversion-state` — 1 script. `int`/`float`/`bool`; `pine.js` rules on each separately |
| a **REQUEST** fed by state | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:request-with-state` — 2 scripts |

⚰️⚰️ **THE SERIES BRIDGE WAS OVER-SIZED BY FOUR SCRIPTS, AND 2F-1 IS WHAT FOUND
IT.** With the pointwise 14 executing, the residual bucket was re-read BY NAME
instead of by count, and `runtime:call-windowed-state` held `str.upper`, `int`,
`iff` and `cum` beside `ema`, `sma` and `wma`. Measured against `TABLE.functions`,
none of those four is windowed — three are not declared by the closed table **at
all**, so their wall is the builtin existing, and one is a numeric cast. Left
alone, this matrix would have priced the series bridge at 13 when it is 9, and
hidden a text demand and a conversion demand inside a series row. This is the
same defect 2E fixed one level up (`runtime:call-with-state` was three
capabilities wearing one label) — **a residual bucket is a hypothesis, not a
family, until someone reads the names in it.**

## Outputs, presentation, objects

| family | PARSE | SEM | IR | RUN | PROD | notes |
|---|---|---|---|---|---|---|
| `plot` | ✅ | ✅ | ✅ | ✅ | ⬜ | multi-output: outputs emitted in source order |
| `plotshape`/`plotchar`/`plotarrow` | ✅ | ✅ | ✅ | ✅ | ⬜ | first argument carried as a value series |
| `fill`/`bgcolor`/`barcolor`/`hline` | ✅ | ✅ | ⬜ | ⬜ | 🟡 | `runtime:presentation` — the presentation program's, not this lane's |
| `plotcandle`/`plotbar` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:presentation` |
| `alertcondition`/`alert` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:presentation` |
| line / label / box / table ops | ✅ | ✅ | 🟡 | ⬜ | ✅ | `runtime:object-op` — **C3B already renders these**; the runtime lane will DRIVE that program, not rebuild it |
| `max_bars_back` and directives | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:directive` |

## Context, MTF, realtime, product

| family | PARSE | SEM | IR | RUN | PROD | notes |
|---|---|---|---|---|---|---|
| Pine version metadata | ✅ | ✅ | ✅ | ✅ | ⬜ | carried onto the IR and the program |
| `bar_index` | ✅ | ✅ | ✅ | ✅ | ✅ | via the column seam |
| `last_bar_index` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | H8, lane-dependent (undefined for a screener column) |
| `barstate.*` | ✅ | 🟡 | ⬜ | ⬜ | 🟡 | |
| `request.security` / MTF | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | execution context is SHAPED for it; nothing implemented |
| realtime / forming bar | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | context carries `confirmed`; no semantics yet |
| persistence of a runtime program | — | — | ⬜ | ⬜ | ⬜ | **not started** — see the gap register |
| chart integration | — | — | — | ⬜ | ⬜ | deliberately not wired (§43) |
| screener integration | — | — | — | ⬜ | ⬜ | deliberately not wired (§44) |
| numeric screener projection | — | — | ⬜ | ⬜ | ⬜ | open product gap, unchanged |

---

## Measured coverage — where real scripts get to (§37)

Instrument: `app/src/components/chart/engine/ast/runtimeFrontendCoverage.test.js`
(`RUNTIME_CORPUS_DIR` / `RUNTIME_COVERAGE_OUT`).

| corpus | n | **executed end-to-end** | stopped at the front end |
|---|---|---|---|
| blind | 48 | **19** | 29 |
| community | 30 | **5** | 25 |
| curated Pine | 21 | **3** | 18 |
| OOS-1 frozen | 60 | 0 | 60 |
| OOS-2 parity | 10 | 0 | 10 |
| **total** | **169** | **27** | 142 |

⚰️ This table read `159` across FOUR corpora while the census beneath it quoted
five — the fifth (`tests/fixtures/oos2_parity`, 10 scripts) was being measured and
not counted. Re-measured 2F-1: all five, one instrument, one run each.

**Differential against the columnar lane, where both lanes describe the
indicator** (paired output-for-output, 1e-9): **blind 18/19 · community 5/5 ·
curated 3/3.** The single exception is named and exempted with its reason.
OOS-1 and parity contribute no pairs — nothing in them executes yet.

### The next dependency, on the frozen OOS-60

⚰️ **THE 2D-2 CENSUS THAT STOOD HERE IS SUPERSEDED** — it read `runtime:function`
18 and would have contradicted the later section in the same document, which is
the second-authority-over-one-value defect this repo pays for most often.
**The live census is under "Next dependency … after 2F-2A".**


---

## UDF fine grain (§64) — after 2E

⛔ **`UDF ✅` after the first call works is exactly what this table exists to
prevent.** Rows, not a word.

| row | status | note |
|---|---|---|
| PARSE | ✅ | reuses `pine.js`'s statement tree |
| SEMANTIC DEFINITION | ✅ | name, params, frame, persistent count, body, result, effects, source location |
| SYMBOL RESOLUTION | ✅ | declared-before-use, matching Pine; a self-call is `runtime:recursion` by name |
| CALL IR | ✅ | `EXPR.CALL {fn, site, args}` — the site is validated, not optional |
| CALL FRAME | ✅ | frame-relative addressing; one locals array, a base per invocation |
| ARGUMENTS | ✅ | pushed left-to-right, popped in reverse; order fixed in the lowering |
| ORDINARY LOCALS | ✅ | cleared on **every invocation**, not per bar |
| PERSISTENT LOCALS | ✅ | `var` inside a function |
| **PER-CALL-SITE STATE** | ✅ | **the load-bearing 2E invariant** — mutation-proven |
| NESTED CALL | ✅ | incl. a stateful helper inside another function |
| STATEFUL CALL | ✅ | result assignable, re-usable, order-correct |
| PURE CALL | ✅ | executes; classified `pure` but **not yet routed to the graph** (§26 deferred) |
| RETURN (single value) | ✅ | Pine's last-statement value, incl. a final binding |
| STATE-DERIVED ARGUMENT | ✅ | `f(acc)` |
| PURE-GRAPH ARGUMENT | ✅ | `f(ta.sma(close,10))` — the column seam through a frame |
| PARAMETER (member input) | ✅ | same logical input as every other lane |
| RESOURCE BOUNDS | ✅ | `CALL_DEPTH` + `CALL_COUNT`, and in-call instructions charged to the same budget |
| TUPLE RETURN | ⬜ | ABI is a general Pine value, not a numeric register — ready, not built |
| ARRAY ARG / RETURN | ⬜ | |
| OBJECT ARG / RETURN | ⬜ | |
| LOOP IN UDF | ⬜ | refuses `runtime:loop`, and refuses the **whole program** (§44) |
| HISTORY IN UDF (over a variable) | ⬜ | `runtime:history-variable`, unchanged |
| GLOBAL MUTABLE READ IN UDF | ⬜ | `runtime:function-global-state` — a frame has no address for a caller slot |
| DEFAULT PARAMETER VALUES | ⬜ | `runtime:function`, named |
| **VENDOR VERIFIED (per-call-site state)** | ✅ | **2E-CLOSE, 2026-09-08.** TradingView's own chart model, SPY 1D NYSE Arca, 300 bars, compiled-study identity proven before any value was read. A steps by 1, B by 10, **B = 10×A on every row, 0 deviations** — per call site, not per definition. **v5 and v6 agree.** Fixture `tests/fixtures/vendor/runtime/callsite-state-spy-1d-2026-09-08.json`, rail `runtime/__tests__/vendorCallSiteState.test.js`. |
| PROD INTEGRATED | ⬜ | chart and screener still deliberately unwired |

**Therefore the honest headline is `STATEFUL UDF CALL FRAMES COMPLETE` (§66) —
not "UDF support complete".**

## History fine grain (§62) — after 2F-2A

⛔ **`HISTORY ✅` FROM `x[1]` ALONE IS EXACTLY WHAT THIS TABLE EXISTS TO PREVENT.**
Rows, not a word — the same discipline the UDF table below applies to `UDF ✅`.

| row | status | note |
|---|---|---|
| TOP-LEVEL PURE HISTORY (a column) | ✅ | pre-2F-2; `READ_HIST` indexes a series the columnar lane already built |
| **TOP-LEVEL MUTABLE HISTORY** | ✅ | `READ_HIST_SLOT` against a committed ring |
| `var` HISTORY | ✅ | the ring reads the persist array |
| BAR-LOCAL RUNTIME HISTORY | ✅ | a non-`var` mutable value bears history **and still resets every bar** (§21) |
| CURRENT vs COMMITTED distinct | ✅ | separate stores; the live slot is never read as history |
| END-OF-BAR COMMIT | ✅ | a phase keyed to bar advance, never to an assignment |
| MULTIPLE SAME-BAR ASSIGNMENT | ✅ | the bar's FINAL value is what it commits — **UNPINNED, see VENDOR below** |
| `na` WARM-UP | ✅ | `b > committed` is `na`; never a clamp to the earliest bar |
| HISTORICAL `na` | ✅ | a committed `na` reads back as `na`, indistinguishable from warm-up **as Pine intends** |
| DEPTH `x[n]`, n > 1 | ✅ | ring sized to the deepest offset any site asks for |
| LITERAL OFFSET | ✅ | 30 of the 35 census scripts |
| INPUT-DERIVED OFFSET | ✅ | folded off the CANONICAL TREE; freezes the input's DEFAULT, matching `pine.js` |
| RUNTIME-DERIVED OFFSET | ⬜ | `runtime:history-dynamic-offset` — every corpus instance is inside a `for` body |
| HISTORY OVER AN EXPRESSION | ⬜ | `runtime:history-expression` — `(a+b)[1]` needs its own committed series |
| UDF-LOCAL HISTORY | ✅ | **P7.2** — a ring per (call site, local). Demand **17 scripts / 82 sites**; first blocker was **1** |
| UDF PARAMETER HISTORY | ✅ | **P7.2** — the shape 21 of the 24 windowed scripts actually use |
| UDF `var` HISTORY | ✅ | live persistence and committed history are separate stores, both per site |
| UDF ORDINARY-LOCAL HISTORY | ✅ | bears history and still resets per invocation — railed, not assumed |
| NESTED-UDF HISTORY | ✅ | caller and callee rings are disjoint |
| DISTINCT CALL-SITE HISTORY | ✅ | `historyBase` per site; **mutation-proven** — sharing one ring turns a rail red |
| CONDITIONAL UDF HISTORY | ✅ | **VENDOR-PINNED v5+v6**: chart-bar indexed, HOLDS across skipped bars |
| LOOP-INVOKED CALL-SITE HISTORY | ⬜ | the held cell commits the LAST invocation of a bar — the natural reading, **not vendor-pinned** (S6.5) |
| FINITE WINDOW OVER RUNTIME SERIES | ✅ | **2F-2B** — 12 members, ONE authority (`interpret.js::FINITE_WINDOW`), no synthetic column |
| RECURRENT OVER RUNTIME SERIES | ⬜ | **2F-2C**; own initialisation, not a ring |
| CUMULATIVE OVER RUNTIME SERIES | ⬜ | `cum` is not in the closed table at all — a TABLE gap, not a runtime one |
| REALTIME / FORMING-BAR HISTORY | ⬜ | the commit counter is the only thing it needs to touch (§27) |
| LOOP-COMPATIBLE COMMIT | ✅ | commit is per BAR, so N invocations in one bar commit once (§26) |
| RESOURCE ACCOUNTING | ✅ | `HISTORY_SLOTS` + `HISTORY_VALUES`, charged at run time and capped at compile time |
| GRAPH-vs-RUNTIME DIFFERENTIAL | ✅ | 8 paired history cases + **all 12 window members**, index for index, warm-up included |
| MUTATION CONTROLS | ✅ | 5 history + **13 window** wrong implementations, each turns a rail red (`tools/window_mutations.py`, clean-file control first) |
| **VENDOR VERIFIED** | ✅ | **2F-2A-CLOSE** — TradingView v5 AND v6, SPY 1D, 400 rows. Both wrong models positively excluded. Gate **18/18** |
| PROD INTEGRATED | ⬜ | the runtime lane is still deliberately unwired (§43/§44) |

### ⭐⭐⭐ VENDOR: the history pin WAS taken — v5 and v6 agree

Fixture `tests/fixtures/vendor/runtime/mutable-history-spy-1d-2026-09-08.json`;
rail `runtime/__tests__/vendorMutableHistory.test.js`. SPY · NYSE Arca · 1D · 400
rows over ~8,459 loaded bars. Identity proved from the model first
(`shortDescription`, 4 plots A/B/C/D, study `pTxDCO`, no other UCT study).

| measurement | v5 | v6 |
|---|---|---|
| distinct `A − B` | `[1]` | `[1]` |
| `B[i] === A[i−1]` | 399/399 | 399/399 |
| distinct `C − D` | `[100]` | `[100]` |
| `D[i] === C[i−1]` | 399/399 | 399/399 |
| rows where `B === A` (reads-current) | **0** | **0** |
| rows where `D === A−1` (commits-at-first-assignment) | **0** | **0** |

**`x[1]` is the previous COMMITTED bar**, and **a bar that assigns several times
contributes its FINAL value**. `C − D = 100` is the discriminating cell: had Pine
committed at the first assignment, `D` would be `A−1` rather than `(A−1)×100`.
Both wrong models are positively excluded, not merely unobserved.

⚠️ **Not pinned, and the fixture says so:** the window starts at `A = 8060`, so
warm-up at bar 0 was not observed, and a committed-`na` history value was not
probed. UCT answers both by rules its columnar lane already applies; the vendor
has not been asked.

⚰️ **Capture technique, for whoever does the next one.** In this tab
(`visibilityState: "hidden"` even while rendering) `execCommand` selectAll and
insertText BOTH return `true` and change nothing, `navigator.clipboard` never
resolves, Monaco is unreachable from the DOM, and the rendered `.view-line` DOM
is stale and wrong. What works is the extension's own key/type dispatch, line by
line, with `Escape` before each `Return` to kill the autocomplete widget. Monaco
auto-close is OFF here (measured), so type every closing character; keep the
probe FLAT so auto-indent has nothing to corrupt.

### ⚰️ The earlier attempt, kept because the failure mode is the lesson

§32/§33 ask TradingView what a mutable value commits as its bar value. **No
evidence was captured, and none was invented.**

The chart tab is `visibilityState: "hidden"`, and the authoring path fails there
exactly as 2E-CLOSE measured: `execCommand('selectAll')` returned `true`,
`execCommand('insertText')` returned `true`, and **the editor content did not
change** — it still held the leftover *UCT modulo probe* from the previous
session. Pressing *Add to chart* would have compiled THAT script and returned
modulo values to be recorded as history truth. The Monaco instance is not
reachable from the DOM either (no React fiber, no own properties), so the
focus-free route does not exist.

⭐ **THE IDENTITY GATE WORKED** — the leftover would have been caught by its
`shortDescription` — but a write path that reports success and lands nothing
cannot be trusted to produce evidence at all. Stopped per *NO VENDOR EVIDENCE is
preferable to FALSE VENDOR EVIDENCE*.

**Environment left clean:** no study added to the chart, editor unchanged, no
layout saved, no brokerage state touched.

**To close it:** the tab needs to be in the FOREGROUND, as it was for 2E-CLOSE.
The probe is written and flat by design — no indented blocks, so Monaco's
auto-indent cannot corrupt it:

```
//@version=5
indicator("UCT history probe")
var c = 0.0
c := c + 1
var m = 0.0
m := close
m := m + 1000
plot(c, "A")
plot(c[1], "B")
plot(m, "C")
plot(m[1], "D")
```

`B` must be `A − 1` on every bar with history (the one-bar lag), and `D` must be
the previous bar's `C` — which is `close[1] + 1000` and **not** `close[1]`, the
discriminating cell for §33: if Pine committed at the first assignment rather
than at end of bar, `D` would lack the `+1000`.

## Measured coverage after 2F-2A

| corpus | n | executed | differential |
|---|---|---|---|
| blind | 48 | 19 | 18/19 |
| community | 30 | 5 | 5/5 |
| curated | 21 | 3 | 3/3 |
| OOS-1 | 60 | 0 | — |
| parity | 10 | 0 | — |

⚠️ **Executed counts did not move, and that is the expected shape** (§42) — it was
the expected shape after 2E for the same reason. Every script that cleared the
pointwise wall hit its NEXT true dependency; none regressed, and none started
executing with an unproven number. What moved is the wall.

### The transition, measured by NAME on the same instrument

⭐ Not by histogram arithmetic. The pointwise classifier was fitted with a kill
switch, all five corpora were re-measured with it armed, and the front end was
restored **byte-identically** (sha256 `a95c6208…`) — never by `git checkout`
(`feedback_mutation_check_never_git_checkout`). The armed run reproduced the
recorded 2E number exactly (OOS-60 = 8), which makes it the mutation control as
well as the baseline: with the pointwise path off, these fourteen scripts come
straight back.

| corpus | `call-pointwise-state` before → after |
|---|---|
| OOS-1 | **8 → 0** |
| curated | 3 → 0 |
| community | 2 → 0 |
| parity | 1 → 0 |
| blind | 0 → 0 |
| **total** | **14 → 0** |

Where each of the fourteen went next — every one a NEW, further dependency:

| script | new wall |
|---|---|
| `high_engagement__03-supertrend-kivancozbilgic` | `runtime:history-variable` |
| `high_engagement__14-heikin-ashi-candle-overlay-bjorgum` | `runtime:history-variable` |
| `high_engagement__16-klinger-volume-oscillator-everget` (×2 corpora) | `runtime:history-variable` |
| `05-chandelier-exit` · `10-supertrend` | `runtime:history-variable` |
| `high_engagement__20-ehlers-fisher-transform-cheatcountry` | `pine:request` |
| `long_tail__19-session-fibs-falcon-ai` · `mid_engagement__16-ict-smc-guide` · `06-adx-advanced` | `pine:function` |
| `mid_engagement__17-volume-surge-radar` | `pine:text-value` |
| `mid_engagement__21-market-compass-dynamic-range` | `pine:window` |
| `13-relative-strength-vs-benchmark-spy` | `runtime:call-windowed-state` |
| `14-bollinger-bands-fixed-timeframe` | `pine:builtin` |

⭐⭐ **`runtime:history-variable` is the capability this wave exposed** — six of the
fourteen land on it, and it was invisible while the pointwise wall stood in front
of it. History over a mutable variable (a per-slot ring buffer committed at end of
bar, refused today rather than approximated with the current value) is now the
single largest runtime-side demand the census can see.

### Next dependency on the frozen OOS-60, after 2F-2A

`runtime:history-variable` **3 → 0** (7 → 0 across all five corpora).

`pine:block` 9 · `pine:text-value` 7 · `runtime:presentation` 7 ·
`runtime:call-windowed-state` **5** · `pine:character` 4 · `pine:collection` 4 ·
`pine:function` 3 · `pine:statement` 3 · `runtime:udt` 3 · `pine:builtin` 2 ·
`pine:colour-value` 2 · `runtime:directive` 2 · `runtime:expression-statement` 2 ·
`runtime:tuple` 2 · `pine:request` 1 · `pine:window` 1 ·
`runtime:call-conversion-state` 1 · `runtime:call-text-state` 1 ·
`runtime:request-with-state` 1.

## ⭐⭐⭐ TOTAL DEMAND vs FIRST BLOCKER — every family (§7/§8)

Instrument: `ast/capabilityDemandCensus.test.js`
(`CAPABILITY_CENSUS_OUT`). 169 scripts, 27 executing end-to-end.

⛔⛔ **FIRST-BLOCKER COUNTS ARE NOT DEMAND.** Every capability row this matrix has
ever published was priced by "how many scripts stop here today", which is
structurally a LOWER BOUND because an earlier gap hides everything behind it. The
gaps are not small:

| family | **TOTAL DEMAND** | sites | first blocker | hidden behind other gaps |
|---|---|---|---|---|
| presentation | 156 | 1127 | 20 | 136 |
| windowed builtin (any) | 149 | 937 | — | — |
| state (`var` / `:=`) | 89 | 2412 | — | — |
| **user functions** | **76** | 520 | **0** | **76** |
| graphical objects | 67 | 1816 | 1 | 66 |
| text | 51 | 678 | 11 | 40 |
| loops | 47 | 280 | 4 | 43 |
| tuples | 46 | 207 | 15 | 31 |
| arrays / collections | 45 | 1655 | 8 | 37 |
| **runtime history** | **35** | 172 | **1** | **34** |
| MTF / `request` | 33 | 128 | 5 | 28 |
| conversions | 29 | 95 | 1 | 28 |
| **`else if`** | **27** | 75 | — | — |
| **windowed OVER STATE** | **24** | 165 | **11** | **13** |
| `switch` | 14 | 17 | 0 | 14 |
| user-defined types | 9 | 13 | 5 | 4 |
| `varip` | 0 | 0 | 0 | 0 |

⭐ **User functions are the sharpest case: ZERO scripts stop there and 76 use
them.** 2E's work is load-bearing for 45% of the corpus and the matrix could not
have said so. History: 1 vs 35. Objects: 1 vs 67. `else if`: 1 vs 27.

⚰️⚰️ **THE WINDOWED DETECTOR WAS WRONG TWICE, AND THE SECOND ERROR RESHAPED THE
NEXT WAVE.** Draft one reported DEMAND 4 against FIRST_BLOCKER 11 — an impossible
ordering the consistency rail caught. Draft two reached 6, and checking the
OVERLAP found **zero** of those six among the eleven that actually block. The
guard is dominated by windowed calls **inside a UDF body over its parameters**
(`HMA(src, len) => wma(src, len)`) — a parameter is a frame slot — not by windowed
calls over a top-level `var`. So 2F-2B's real target is *a finite window over a
series produced inside a call frame*, a harder shape than the top-level one.

⚠️ Declared imprecision: the detectors are SYNTACTIC (they run over the lexer's
tokens, so a keyword in a comment or string cannot count, but they do not
type-check), and 3 of the 11 first-blocker windowed scripts are still undetected.
The instrument pins no number.

### ⭐⭐ THE DEMAND NUMBER THIS MATRIX HAS BEEN UNDER-REPORTING

`historyDemandCensus.test.js` measures two different questions, and the one this
table has always shown is the smaller:

| question | answer |
|---|---|
| scripts whose EARLIEST blocker was history | **7** of 169 |
| scripts that CONTAIN `x[n]` over a value they mutate | **35** of 169 |

⛔ **THE EARLIEST-BLOCKER NUMBER IS A LOWER BOUND, ALWAYS.** A script stopped on a
tuple wants history just as badly and cannot say so yet, so a capability's row
here systematically under-prices it. Both numbers are now reported for history;
every other row in this matrix still shows only the first, and should be read
accordingly.

Depth demand, measured over those 35: **29 scripts at `[1]`, one at `[2]`, none
deeper**; 7 scripts use a non-literal offset. That measurement — not a guess —
is what sets `HISTORY_SLOTS`/`HISTORY_VALUES` and why the ring is sized per slot
rather than reserved in bulk.


## 2F-2B — FINITE WINDOWS OVER RUNTIME SERIES

### What shipped

`ta.sma(x, 20)` where `x` is a value the runtime mutated — at top level, over a
UDF parameter, over a UDF local, over UDF `var` state, across two call sites, and
through a skipped call site — now EXECUTES in the runtime lane.

| member | span | member | span |
|---|---|---|---|
| `sma` | n | `median` | n |
| `wma` | n | `highest` | n |
| `stdev` | n | `lowest` | n |
| `sum` | n | `highestbars` | n |
| `dev` | n | `lowestbars` | n |
| `rising` | **n+1** | `falling` | **n+1** |

⭐⭐ **ONE SEMANTIC AUTHORITY, AND IT IS `interpret.js`.** `FINITE_WINDOW` is a
table of `{reduce, span}` pairs. The columnar lane feeds it through `rolling`,
which walks the whole series; the runtime feeds it a `span`-wide scratch buffer
refilled per bar from the committed ring. **It is the same function object** —
there is no second SMA to keep in step, and no synthetic column is ever
materialised out of the ring.

⭐ **THE SPAN COMES FROM THE TABLE, NOT THE CALL SITE.** `ta.rising(x, n)`
compares n+1 bars to answer about n intervals. Asking the table means the two
lanes cannot disagree about how wide a window is; a mutation that reads `n` at
the call site turns a rail red.

### ⛔⛔ The defect the differential caught — a sign, not a magnitude

`ta.highestbars` returns a **NON-POSITIVE** offset (0 on this bar, −1 one bar
back). This engine's table entry returns the **POSITIVE** distance, and `pine.js`
reconciles them in `PINE_NAMESPACED_TREE` by translating the Pine spelling as
`-highestbars(src, n)`. The runtime front end reached the bare table entry
through its namespace strip and **lost the negation** — right magnitude, wrong
sign, on two of twelve members. Nothing in the suite that checked a magnitude
could have seen it; the index-for-index differential against the columnar lane
is what did.

The fix does not restate the rule. `namespacedWindowShape` hands
`PINE_NAMESPACED_TREE`'s own builder two probe nodes and reads the tree back; it
admits a rewrite only when it is exactly `-<member>(src, len)` with the probe
nodes returned in order **as the same objects**. `ta.pivothigh` is rewritten into
a confirmation-bar SHIFT, fails that match, and refuses. A third entry added
tomorrow is measured on the day it lands, not the day someone remembers.

⚠️ Against the shipped table every guard in that function except the `u-` test is
dead code — both real entries are already the right shape, so deleting the arity,
identity or membership checks changes no answer and a mutation run would report
them all surviving. So the `tree` parameter is exported for the rail, exactly as
`pointwiseTarget`'s `shapes` is, and 12 synthetic rewrites the real table cannot
spell (reordered arguments, a defaulted source, a non-member call, a builder that
throws) exercise each guard.

### ⛔⛔ THE TRANSITION, MEASURED A/B ON ONE TREE — AND IT IS NOT A COVERAGE WIN

Both columns are the SAME working tree, 169 scripts, five corpora; the "before"
column is that tree with the window router cut and byte-exactly restored.

| first blocker | before | after | Δ |
|---|---:|---:|---:|
| `runtime:call-windowed-state` | 11 | **8** | **−3** |
| `runtime:function-global-state` | 0 | 2 | +2 |
| `runtime:history-expression` | 0 | 1 | +1 |
| **fully executing (OK)** | **27** | **27** | **0** |

⛔ **ZERO SCRIPTS BECAME EXECUTABLE.** Three moved past the windowed wall —
`community/07-hull-suite`, `curated/05-mtf-structure-bias`,
`oos1/high_engagement__04-ttm-squeeze-greeny` — and all three landed on the NEXT
wall. That is what a foundation dependency looks like, and calling it progress
would be `lesson_a_refusal_count_is_not_a_progress_metric` run in reverse. The
census predicted it: windowed-over-state carried **24 scripts of demand** against
**11 first-blocker**, so most of that demand was always sitting behind something
else.

⭐⭐ **THE USEFUL RESULT IS WHAT THE 8 SURVIVORS ARE BLOCKED ON: every one of them
uses `ta.ema`.** The `runtime:call-windowed-state` guard's remaining population is
now entirely the RECURRENT family. That is 2F-2C, and this is the evidence for
sequencing it next — measured, not assumed.

The two new blockers are both nameable and small:

| new first blocker | what it is |
|---|---|
| `runtime:function-global-state` (2) | a window inside a UDF over a GLOBAL the function reads, rather than over a parameter |
| `runtime:history-expression` (1) | `sma(a + b, n)` — the expression needs its own committed series, exactly as `(a+b)[1]` does |

### ⭐ What it costs — and the 5,000-symbol scan

Measured by `windowPerf.test.js` (VM only; compiling Pine is once per scan).

| sites | span | bars | ms | cells |
|---:|---:|---:|---:|---:|
| 1 | 20 | 300 | 0.37 | 5,620 |
| 1 | 20 | 5,000 | 5.62 | 99,620 |
| 10 | 20 | 5,000 | 37.09 | 996,200 |
| 40 | 20 | 5,000 | 142.40 | 3,984,800 |

Linear in bars (15.2× the time for 16.7× the bars) and linear in sites.

⭐⭐ **SPAN IS ALMOST FREE, WHICH IS THE FINDING WORTH KEEPING.** At 2,000 bars,
going from span 5 to span 200 — **40× the cells**, 9,980 → 360,200 — cost
**1.3× the time** (2.11ms → 2.76ms). Per-bar dispatch dominates; the inner
reduction over a contiguous `Float64Array` is nearly invisible. So `sma(x, 200)`
is not the expensive thing a reviewer would assume — the number of SITES is.

| 5,000-symbol scan | per symbol | whole scan | cells/symbol |
|---|---:|---:|---:|
| typical (4 windows, 300 bars) | 0.97 ms | **4.9 s** | 22,480 |
| heavy (8 windows × span 200, 5,000 bars) | 42.8 ms | **214 s** | 7,681,600 |

⚠️ `WINDOW_CELLS` (100M) is charged **per execution**, so it bounds a runaway
SYMBOL, not a runaway SCAN. The heavy row is 7.7M cells for one symbol — well
inside the ceiling and still 3.5 minutes across the market. Budgeting the scan is
not this wave's to solve, and this table is the evidence for whoever does it.

### ⚠️ MEASURED GAP, recorded rather than fixed

`ta.sma(x, k + 2)` where `k` is an input **refuses**. A bare input name folds
because `pine.js` substitutes the frozen default and the canonical node IS a
`num`; `k + 2` stays an `op` node. The fold is CONSERVATIVE — a refusal, never a
wrong width — but it is a real gap. Closing it means consulting `pine.js`'s own
`constantValueOf` (with its fold budget), which touches history offsets too and
is therefore not 2F-2B's to change. Pinned as a fact in `finiteWindow.test.js`
with an instruction to assert the value rather than delete the case when it lands.

A surviving mutation also surfaced that **fractional and negative lengths were
untested** — `ta.sma(x, 2.5)` refuses, and nothing checked it, so cutting both
halves of the fold's integer guard left the suite green. Covered now.

### ⚰️ Four tests asserted the wall this wave removed

`pointwise`, `history`, `sourceToRuntime` and `elseIfChain` each pinned
`ta.sma(x, 5)` as refused. All four are re-pointed at `ema`/`rma`/`barssince` and
annotated in place rather than deleted — **a green test asserting a capability has
NOT shipped, on the day it shipped, is exactly what this register exists to make
visible.**

## EXECUTION SHAPES — all 70 closed-table builtins (2026-09-08)

Measured by `ast/executionShapeCensus.test.js`. The partition is TOTAL and
DISJOINT and railed as such; `pointwise`, `finiteWindow` and `forward` are
DERIVED from `isPointwise`, `FINITE_WINDOW` and the table's own `forward:` flag,
so they cannot drift from the authorities that own them.

| shape | members | status | REACH (of 169 scripts) | what a bar loop needs |
|---|---:|---|---:|---|
| `pointwise` | 19 | ✅ 2F-1 | 86 | nothing — one bar in, one out |
| `finiteWindow` | 12 | ✅ 2F-2B | 126 | `span` committed bars + the live one |
| `carried` | 16 | ⬜ **2F-2C** | **112** | N scalar cells, one step per bar, a reset rule |
| `windowComposite` | 17 | ⬜ | 20 | composition over `FINITE_WINDOW` |
| `offsetOne` | 3 | ⬜ | 17 | **`x[1]` — already shipped** |
| `forward` | 3 | ⬜ | 18 | a bar that has not happened |

⚠️ **REACH IS A CEILING, NOT DEMAND.** It counts any mention, including over
plain columns the pure lane already serves. `capabilityDemandCensus.test.js`
owns the narrower "fed by runtime state" number; the two are not comparable and
must never be summed.

⭐⭐⭐ **THE SCAN-BACKWARDS FAMILY IS `barssince` + `valuewhen`, AND IT IS A
SUBSET OF `carried`.** Both columnar implementations are single FORWARD passes
carrying two scalars with a declared reset on `na` — structurally identical to
`smoothCol`'s `prev`/`count`/`sum`. The name describes the semantics, not the
execution; a runtime that took it literally would build ring machinery for a
problem that needs one cell. Their `int` argument is a bounded-fetch honesty
limit, not a scan depth. Full measurement: gap register **PART U**.
