# PINE LANGUAGE + RUNTIME COMPLETION MATRIX

As of C4 Phase 2F-2A. Branch `worktree-indicator-ecosystem`.

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
| **history `x[n]` over a MUTABLE variable** | ✅ | ✅ | ✅ | ✅ | ⬜ | **2F-2A** — a committed ring per history-bearing slot. See the fine-grain table below; `VENDOR ⬜` |

## State and control flow

| family | PARSE | SEM | IR | RUN | PROD | notes |
|---|---|---|---|---|---|---|
| ordinary local declaration | ✅ | ✅ | ✅ | ✅ | ⬜ | frame reset every bar — a local read before assignment is `na` |
| `var` declaration | ✅ | ✅ | ✅ | ✅ | ⬜ | initialiser JUMPED OVER once initialised |
| `var x = na` | ✅ | ✅ | ✅ | ✅ | ⬜ | initialisation tracked separately from value |
| `:=` reassignment | ✅ | ✅ | ✅ | ✅ | ⬜ | statement order observable |
| `if` / `else` as statements | ✅ | ✅ | ✅ | ✅ | ⬜ | mutation in either branch; nested |
| `else if` chains | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | 🔴 **THIS ROW READ `✅ ✅ ✅ ✅` AND WAS FALSE** — see below |
| `na` does not take a branch | ✅ | ✅ | ✅ | ✅ | ⬜ | |
| block-local scope + shadowing | ✅ | ✅ | ✅ | ✅ | ⬜ | a slot per DECLARATION, never per name |
| `switch` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:switch` |
| `varip` | ✅ | ✅ | ⬜ | ⬜ | ⬜ | `runtime:varip` — intrabar, which a closed-bar runtime cannot reproduce |

🔴🔴 **`else if` DOES NOT WORK IN THE RUNTIME LANE, AND THIS TABLE SAID IT DID.**
Measured 2F-2 with a minimal repro, after the corpus pushed a script onto it:

| source | runtime front end | shipped columnar door |
|---|---|---|
| `if` / `else` | ✅ | ✅ |
| `if` / `else if` / `else` | 🔴 `runtime:statement` — *"`else` with no `if`"* | ✅ |
| `if` / `else if` / `else if` / `else` | 🔴 same | ✅ |

⚰️ **THE ROW WAS MEASURING THE WRONG LANE.** The shipped door handles chains
fine, so a spot check there corroborates a claim about a front end that cannot do
it at all. `pine/15-anchored-vwap` and `pine/10-supertrend` both sit on this today
— the second only reached it *because* 2F-2 removed the history wall in front of
it, which is how the false row surfaced.

⛔ **NOT FIXED IN 2F-2, DELIBERATELY.** The directive scopes this wave to history
and says not to patch adjacent families to move acceptance (§35/§43). The row is
corrected to the truth and the gap is registered (P7.4) as the cheapest
high-value control-flow item — the IR already holds nested `IF`, so this is a
front-end chaining fix, not an architecture change.

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
| UDF-LOCAL HISTORY | ⬜ | `runtime:history-function-local` — 1 script (`curated/02-ict-retracement`) |
| UDF `var` HISTORY | ⬜ | same refusal; needs the per-call-site ring base |
| DISTINCT CALL-SITE HISTORY | ⬜ | designed (mirrors `persistBase`), not built |
| CONDITIONAL UDF HISTORY | ⬜ | §25 — Pine's answer for a SKIPPED call site is not pinned |
| FINITE WINDOW OVER RUNTIME SERIES | ⬜ | **2F-2B**; `runtime:call-windowed-state`, 11 scripts |
| RECURRENT OVER RUNTIME SERIES | ⬜ | **2F-2C**; own initialisation, not a ring |
| CUMULATIVE OVER RUNTIME SERIES | ⬜ | `cum` is not in the closed table at all — a TABLE gap, not a runtime one |
| REALTIME / FORMING-BAR HISTORY | ⬜ | the commit counter is the only thing it needs to touch (§27) |
| LOOP-COMPATIBLE COMMIT | ✅ | commit is per BAR, so N invocations in one bar commit once (§26) |
| RESOURCE ACCOUNTING | ✅ | `HISTORY_SLOTS` + `HISTORY_VALUES`, charged at run time and capped at compile time |
| GRAPH-vs-RUNTIME DIFFERENTIAL | ✅ | 8 paired cases, both lanes, 1e-12 |
| MUTATION CONTROLS | ✅ | 5 wrong implementations, each turns a rail red |
| **VENDOR VERIFIED** | 🔴 ⬜ | **NOT CAPTURED — see below. The 2F-2A gate is therefore NOT fully met.** |
| PROD INTEGRATED | ⬜ | the runtime lane is still deliberately unwired (§43/§44) |

### 🔴 VENDOR: the 2F-2 history pin was NOT taken, and why

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
