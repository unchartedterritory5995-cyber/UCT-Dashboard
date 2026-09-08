# PINE LANGUAGE + RUNTIME COMPLETION MATRIX

As of C4 Phase 2F-1. Branch `worktree-indicator-ecosystem`.

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
| user-defined functions | ✅ | ✅ | ✅ | ✅ | ⬜ | **2E** — see the fine-grained table below |
| tuples / destructuring | ✅ | ✅ | 🟡 | ⬜ | ⬜ | `runtime:tuple`; `EXPR.TUPLE` declared |
| loops `for` / `while` | ✅ | ✅ | 🟡 | ⬜ | ⬜ | `runtime:loop`; `STMT.FOR`/`WHILE`/`BREAK`/`CONTINUE` declared |
| arrays / matrix / map | ✅ | ✅ | 🟡 | ⬜ | ⬜ | `runtime:array` — routed to the COLLECTION family, not `pine:builtin` |
| user-defined types | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:udt` |
| builtin calls (closed table, 70) | ✅ | ✅ | ✅ | ✅ | ✅ | via `READ_COLUMN` — evaluated once by the columnar lane |
| a **POINTWISE** builtin fed by state | ✅ | ✅ | ✅ | ✅ | ⬜ | **2F-1** — `EXPR.BUILTIN` → `OP.POINTWISE`, applied per bar. **14 → 0** across all five corpora |
| a **WINDOWED** builtin fed by state | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:call-windowed-state` — **9 scripts** (was reported 13; see the correction below). The real series bridge |
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
**The live census is under "Next dependency … after 2F-1".**


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

## Measured coverage after 2F-1

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

### Next dependency on the frozen OOS-60, after 2F-1

`runtime:call-pointwise-state` **8 → 0**.

`pine:block` 9 · `pine:text-value` 7 · `runtime:presentation` 5 ·
`pine:character` 4 · `pine:collection` 4 · `runtime:call-windowed-state` **4** ·
`pine:function` 3 · `pine:statement` 3 · `runtime:history-variable` **3** ·
`runtime:udt` 3 · `pine:builtin` 2 · `pine:colour-value` 2 · `runtime:directive` 2 ·
`runtime:expression-statement` 2 · `runtime:tuple` 2 · `pine:request` 1 ·
`pine:window` 1 · `runtime:call-conversion-state` 1 · `runtime:call-text-state` 1 ·
`runtime:request-with-state` 1.
