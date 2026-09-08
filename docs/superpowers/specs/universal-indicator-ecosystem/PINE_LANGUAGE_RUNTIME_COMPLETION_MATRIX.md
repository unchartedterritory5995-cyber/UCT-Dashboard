# PINE LANGUAGE + RUNTIME COMPLETION MATRIX

As of C4 Phase 2D-2. Branch `worktree-indicator-ecosystem`.

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
| `%` modulo | ✅ | ✅ | 🟡 | 🟡 | ✅ | pure lane only (lowers to `mod`); beside a mutable value it refuses `runtime:operator` |
| `na` | ✅ | ✅ | 🟡 | 🟡 | ✅ | NaN for floats today; the TAG model (`na(someLine)`) is designed, not built |
| history `x[n]` over a column | ✅ | ✅ | ✅ | ✅ | ⬜ | out of range is `na`, never a clamp |
| **history `x[n]` over a MUTABLE variable** | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:history-variable` — needs per-slot history committed at end of bar (2E) |

## State and control flow

| family | PARSE | SEM | IR | RUN | PROD | notes |
|---|---|---|---|---|---|---|
| ordinary local declaration | ✅ | ✅ | ✅ | ✅ | ⬜ | frame reset every bar — a local read before assignment is `na` |
| `var` declaration | ✅ | ✅ | ✅ | ✅ | ⬜ | initialiser JUMPED OVER once initialised |
| `var x = na` | ✅ | ✅ | ✅ | ✅ | ⬜ | initialisation tracked separately from value |
| `:=` reassignment | ✅ | ✅ | ✅ | ✅ | ⬜ | statement order observable |
| `if` / `else` as statements | ✅ | ✅ | ✅ | ✅ | ⬜ | mutation in either branch; nested |
| `else if` chains | ✅ | ✅ | ✅ | ✅ | ⬜ | kept as nested IF, not flattened |
| `na` does not take a branch | ✅ | ✅ | ✅ | ✅ | ⬜ | |
| block-local scope + shadowing | ✅ | ✅ | ✅ | ✅ | ⬜ | a slot per DECLARATION, never per name |
| `switch` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:switch` |
| `varip` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:varip` — intrabar, which a closed-bar runtime cannot reproduce |

## Functions, tuples, collections, types

| family | PARSE | SEM | IR | RUN | PROD | notes |
|---|---|---|---|---|---|---|
| user-defined functions | ✅ | ✅ | 🟡 | ⬜ | ⬜ | `runtime:function`; IR has the `FUNC`/`RETURN` shapes declared |
| tuples / destructuring | ✅ | ✅ | 🟡 | ⬜ | ⬜ | `runtime:tuple`; `EXPR.TUPLE` declared |
| loops `for` / `while` | ✅ | ✅ | 🟡 | ⬜ | ⬜ | `runtime:loop`; `STMT.FOR`/`WHILE`/`BREAK`/`CONTINUE` declared |
| arrays / matrix / map | ✅ | ✅ | 🟡 | ⬜ | ⬜ | `runtime:array` — routed to the COLLECTION family, not `pine:builtin` |
| user-defined types | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:udt` |
| builtin calls (closed table, 70) | ✅ | ✅ | ✅ | ✅ | ✅ | via `READ_COLUMN` — evaluated once by the columnar lane |
| **a builtin FED BY mutable state** | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:call-with-state` — the series bridge, a separately schedulable capability |

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
| **total** | **159** | **27** | 132 |

**Differential against the columnar lane, where both lanes describe the
indicator** (paired output-for-output, 1e-9): **blind 18/19 · community 5/5 ·
curated 3/3.** The single exception is named and exempted with its reason.

### The next dependency, on the frozen OOS-60

`runtime:function` 18 · `runtime:call-with-state` 7 · `runtime:presentation` 5 ·
`pine:text-value` 5 · `pine:character` 4 · `pine:block` 4 · `pine:collection` 3 ·
`runtime:udt` 3 · `runtime:directive` 2 · `pine:statement` 2 ·
`pine:colour-value` 2 · `runtime:expression-statement` 2 · `runtime:tuple` 2 ·
`pine:function` 1.

⭐⭐ **UDFs are the wall now, and by a factor of two and a half over the next
family.** That is the single most useful number this wave produced.
