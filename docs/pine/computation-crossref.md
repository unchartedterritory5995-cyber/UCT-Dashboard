# Lane 2 — the demand-weighted computation picture, cross-referenced against our engine

**What this is.** Every computation feature the 1,443-script community survey actually uses, set against the closed table our Pine translator declares, so the runtime roadmap is ranked by measured demand instead of guesswork. Three denominators are in play and they are kept apart on purpose:

| denominator | what it is | size |
|---|---|---|
| Pine v6 offers | TradingView's own reference payload | 475 distinct function names (719 signature entries), 168 distinct methods (251 entries), 161 variables, 239 constants, 20 types |
| the wild uses | distinct callables across 1443 published scripts | 291 callables, of which 238 are v6 functions |
| we declare | `closedTable.json` | 64 functions, 137 scalars, 5 series, 13 clock values, 15 operators |

**Half of Pine is dead weight.** 237 of the 475 v6 function names — 50% — are never called once in 1,443 published scripts. A runtime that chases the reference manual is chasing a distribution that does not exist. The 64 functions we already declare cover the head of the curve; what is missing is not breadth of vocabulary, it is four structural nodes.

## The answers, up front

1. **139 of the 275 computation features in demand are unsupported** — 123 with no node at all, 16 refused by a deliberate ruling. But only **four structural nodes** (`pine:request`, `pine:function`, `pine:block`, `pine:collection`) account for the first half of the translation gap.
2. **`pine:character` is a bare `.` and a newline inside a string literal.** 183 surveyed scripts hit the dot (12.7%), 75.4% of the sites because they write `f().field`. Every exotic Unicode character in the histogram is a cascade from the multi-line-string bug, measured: 13 of 13 backslash cases and 8 of 9 non-ASCII cases co-occur with a broken string.
3. **The most surprising thing in the cross-reference:** `pine:character` looks like a 16% blocker and is the SOLE blocker for **2 scripts in 1,443**. The lexer runs first and aborts the file, so it takes credit for 184 scripts that were going to fail anyway on loops (86%), UDTs (72%) and collections (62%). The most alarming line in the refusal histogram is a pipeline-order artefact, not a demand signal.
4. **Top 5 unblocks, projected on all 1443:** `pine:request` → 29.7%, `pine:function` → 34.5%, `pine:block` → 40.5%, `pine:collection` → 49.2%, `pine:no-output` → 58.8% (calibrated ≈32/37/44/53/64%), from 24.2% today.
5. **The screener door and a renderer disagree about a quarter of the corpus.** 345 scripts (23.9%) offer no screenable column at all, and 330 of them (22.9%) draw for a living. For a renderer that is not a blocker, it is the product.

## ⚠️ Provenance, stated up front

- The survey (`inventory.json`, `agg_computation.json`) covers **1443 scripts** and is stable.
- `engine_refusal_agg.json` as handed to me was **one complete run over 467 scripts**: 119 translated = **25.5%**. That file was deleted and rewritten while this lane ran.
- I froze `engine_status.json` at **500 judged scripts, 169 translated = 33.8%** (`_lane2/engine_status.snapshot.json`). A second engine run was in progress over a much larger `sources/` directory (2,512 `.pine` files by then), so the two runs cover different populations. Both are reported; neither is silently preferred.
- Only **267 scripts** are in BOTH the survey and the frozen engine run, which is why the projections below are built on a per-script blocker model over all 1,443 and then CALIBRATED against those 267 rather than extrapolated from a rate.

## ⭐ The one structural fact that reshapes every number here

**The translator is demand-driven from the output argument.** `pickOutputArgument` takes the `series`/`condition` argument of `plot`/`alertcondition`/`plotshape`/`plotchar`/`plotarrow` (and the four roles of `plotcandle`/`plotbar`) and resolves only what THAT tree reaches. A binding it cannot translate is marked **opaque** and becomes a *note*, not a refusal — it fires only if a screened value actually reads it. A bare `line.new(...)` statement is noted and ignored.

That is why `pine:drawing` fires on **0 of the 500** judged scripts even though 594 surveyed scripts call `line.new`, and why `pine:collection` fires on only 8 sole-blocked scripts even though `array.get` is in 22.1% of the corpus. **Per-script feature presence in the survey is not the same as blocking**, and any roadmap that reads the survey as a blocker list will over-build collections and under-build the four things that actually stop scripts.

---

# TASK A — the three-way cross-reference

## Status legend (derived, not asserted)

| status | means | derived from |
|---|---|---|
| `supported` | the name resolves and answers Pine's number | a key in `closedTable.json::functions` (via `normaliseName`), or a MEASURED permutation in `PINE_CALL_SHAPES`, or an identity expansion in `BUILTIN_CALL_TREE` / `PINE_NAMESPACED_TREE` |
| `partial` | resolves only under a stated condition | a literal-only length/offset, `sourceMustBe: hlc3`, a foldable `switch` subject, a servable timeframe, a `var` that re-seeds |
| `refused` | a DELIBERATE ruling — the semantics differ or the value is unreproducible | `PINE_INEXPRESSIBLE`, `varip`, `strategy.*`, `pine:declaration-strategy`, non-numeric inputs |
| `absent` | no node at all | falls through to `pine:function` / `pine:collection` / `pine:type` / `pine:block` / `pine:module` / `pine:builtin` |
| `ignored` | never walked, so it never blocks — **and a renderer must implement all of it** | presentation arguments: `color.*`, `str.*`, `alert()`, `input.color`, `input.text_area` |

## Summary

| our status | features | call sites |
|---|---|---|
| `supported` | 75 | 85,197 |
| `partial` | 33 | 74,001 |
| `ignored` | 28 | 22,279 |
| `refused` | 16 | 2,455 |
| `absent` | 123 | 29,696 |
| **total** | **275** | **213,628** |

**Features in demand that we do NOT support: 139** — 123 `absent` (no node) + 16 `refused` (a ruling). They account for 32,151 call sites.

Rolled up by the guard each unsupported feature lands on:

| guard | unsupported features | call sites |
|---|---|---|
| `pine:collection` | 64 | 21,854 |
| `pine:function` | 45 | 2,045 |
| `pine:builtin` | 13 | 548 |
| `pine:strategy-call` | 7 | 401 |
| `pine:input-kind` | 3 | 393 |
| `pine:block` | 2 | 4,810 |
| `pine:type` | 2 | 1,242 |
| `pine:module` | 1 | 246 |
| `pine:request` | 1 | 492 |
| `pine:state` | 1 | 120 |

## ⛔ The `ignored` column is the renderer's bill

28 features, 22,279 call sites, cost the screener **nothing** and are **mandatory** for anything that draws:

| feature | % scripts | call sites |
|---|---|---|
| `color.new` | 59.3% | 9,592 |
| `input.color` | 45.8% | 3,904 |
| `str.tostring` | 33.5% | 4,546 |
| `color.rgb` | 18.6% | 1,801 |
| `color.from_gradient` | 11.5% | 421 |
| `feat:alert_calls` | 10.5% | 587 |
| `str.format` | 4.2% | 278 |
| `str.contains` | 3.0% | 219 |
| `str.substring` | 2.8% | 162 |
| `str.tonumber` | 2.7% | 117 |
| `str.length` | 2.4% | 133 |
| `str.split` | 2.0% | 52 |
| `color.r` | 1.5% | 28 |
| `color.b` | 1.3% | 25 |
| `color.g` | 1.3% | 25 |
| `input.text_area` | 1.2% | 40 |
| `str.pos` | 1.1% | 71 |
| `str.replace_all` | 1.0% | 63 |
| `str.replace` | 1.0% | 46 |
| `str.lower` | 1.0% | 31 |
| `color.t` | 1.0% | 18 |
| `str.repeat` | 0.6% | 39 |
| `str.format_time` | 0.6% | 26 |
| `str.startswith` | 0.4% | 14 |
| `str.trim` | 0.3% | 13 |
| `str.upper` | 0.3% | 12 |
| `str.match` | 0.3% | 12 |
| `str.endswith` | 0.3% | 4 |

## The full table, sorted by demand

`blocked` = scripts that would be blocked if the feature is required and unsupported (0 for supported/partial/ignored).

| feature | % scripts | scripts | call sites | our status | guard | our spelling | blocked | note |
|---|---|---|---|---|---|---|---|---|
| `feat:ternaries` | 92.4% | 1334 | 33889 | `supported` | — | — | — | `?:` is one of the 15 declared operators |
| `feat:history_refs` | 72.6% | 1047 | 16411 | `partial` | `pine:offset-literal` | — | — | the `offset` node exists, but the bar count must be a LITERAL whole number and only ONE `[…]` per value; a negative offset is refused |
| `feat:if_blocks` | 71.9% | 1038 | 28679 | `partial` | `pine:block` | — | — | a bare `if` chain and `x = if …` FOLD into a nested `?:` (foldIfChain); a branch with no value, or a block whose arms differ in shape, refuses |
| `feat:max_history_ref` | 71.6% | 1033 | 6341 | `partial` | `pine:offset-literal` | — | — | depth itself is fine — it becomes `maxLookback`, a static tree sum |
| `feat:var_decls` | 65.6% | 946 | 15660 | `partial` | `pine:state` | — | — | `var x = seed` binds a RECURRENCE and translates as `accum(seed, update, window)`; state that must NOT forget (an unbounded running total) refuses |
| `feat:udf` | 63.8% | 921 | 4847 | `supported` | — | — | — | a `f(x) => …` definition is INLINED at every call site (inlineUserFunction); body may be a single expression or a run of local bindings and folded `if`s |
| `color.new` | 59.3% | 855 | 9592 | `ignored` | `pine:colour-value` | — | — | a colour is never a column — but it is IGNORED in a presentation argument, so it only refuses if a screened value flows through it |
| `input.int` | 58.3% | 841 | 4045 | `supported` | — | `folded to its default` | — | folded to the author default (or the member override inside the author's bounds) |
| `feat:na_guards` | 55.7% | 804 | 7365 | `supported` | — | — | — | `na(x)` and `nz(x,y)` are declared functions |
| `input.bool` | 49.4% | 713 | 5570 | `supported` | — | `folded to its default` | — | folded to the author default (or the member override inside the author's bounds) |
| `feat:for_loops` | 46.3% | 668 | 4476 | `absent` | `pine:block` | — | 668 | no loop node — the grammar is a pure expression tree |
| `input.color` | 45.8% | 661 | 3904 | `ignored` | `pine:input-kind` | — | — | a colour/tooltip knob is only ever read by a presentation argument, which the translator never walks — the binding is marked opaque and never reached |
| `input.string` | 42.1% | 608 | 2760 | `partial` | `pine:input-kind` | `folded as a FIXED STRING (stringValueOf)` | — | refuses as a NUMERIC value, but IS read as a fixed string — it folds a `switch` subject and supplies `request.security`'s timeframe or symbol |
| `bare:na` | 39.9% | 576 | 4814 | `supported` | — | `na` | — | the bare spelling reaches the table directly |
| `input.float` | 35.6% | 513 | 1649 | `supported` | — | `folded to its default` | — | folded to the author default (or the member override inside the author's bounds) |
| `math.max` | 33.8% | 488 | 2134 | `supported` | — | `max (measured shape)` | — | a MEASURED argument permutation in PINE_CALL_SHAPES |
| `str.tostring` | 33.5% | 483 | 4546 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `math.min` | 33.2% | 479 | 1865 | `supported` | — | `min (measured shape)` | — | a MEASURED argument permutation in PINE_CALL_SHAPES |
| `bare:nz` | 32.5% | 469 | 2551 | `supported` | — | `nz` | — | the bare spelling reaches the table directly |
| `feat:alertcondition` | 28.0% | 404 | 1978 | `supported` | — | — | — | an `alertcondition` IS a column (OUTPUT_CALLS) |
| `math.abs` | 26.8% | 387 | 1796 | `supported` | — | `abs` | — | name and arity line up with the table |
| `feat:switch` | 25.1% | 362 | 1175 | `partial` | `pine:block` | — | — | a `switch` whose SUBJECT folds to a constant reduces to the ONE live arm; a subject that moves bar to bar refuses |
| `ta.atr` | 23.1% | 334 | 454 | `supported` | — | `atr (measured shape)` | — | SUPPORTED, with a MEASURED SEED DIFFERENCE. Ours is Wilder's original seeded at bar 1; Pine seeds `ta.rma(ta.tr(true), n)` at bar 0 (counting bar 0's range as `high-low`). Same smoothing: 0.23% apart at the seed, 0.002% by bar 80, 4e-12 by bar 300 — and we will always have ONE FEWER early value than TradingView draws. A cross-product probe read at bar 15 will call this a formula difference; it is not |
| `array.get` | 22.1% | 319 | 5989 | `absent` | `pine:collection` | — | 319 | no collection node in the expression grammar |
| `ta.sma` | 20.9% | 301 | 686 | `supported` | — | `sma` | — | name and arity line up with the table |
| `array.size` | 19.1% | 276 | 3055 | `absent` | `pine:collection` | — | 276 | no collection node in the expression grammar |
| `color.rgb` | 18.6% | 268 | 1801 | `ignored` | `pine:colour-value` | — | — | a colour is never a column — but it is IGNORED in a presentation argument, so it only refuses if a screened value flows through it |
| `ta.highest` | 18.4% | 266 | 494 | `supported` | — | `highest` | — | name and arity line up with the table |
| `feat:udt_types` | 18.3% | 264 | 660 | `absent` | `pine:type` | — | 264 | `type`/`method`/`enum` have no node shape |
| `ta.crossover` | 18.1% | 261 | 560 | `supported` | — | `crossover (measured shape)` | — | a MEASURED argument permutation in PINE_CALL_SHAPES |
| `array.push` | 17.7% | 255 | 4302 | `absent` | `pine:collection` | — | 255 | no collection node in the expression grammar |
| `ta.crossunder` | 17.7% | 255 | 525 | `supported` | — | `crossunder (measured shape)` | — | a MEASURED argument permutation in PINE_CALL_SHAPES |
| `array.new_float` | 17.2% | 248 | 1027 | `absent` | `pine:collection` | — | 248 | no collection node in the expression grammar |
| `ta.lowest` | 17.2% | 248 | 452 | `supported` | — | `lowest` | — | name and arity line up with the table |
| `ta.pivothigh` | 16.6% | 240 | 332 | `partial` | — | `pivothigh(src,L,R)[R]` | — | EXACT IDENTITY — Pine publishes the pivot at its CONFIRMATION bar, ours at the pivot bar, so the translation is `pivothigh(src,L,R)[R]`. The shift also CANCELS the look-ahead, so the translated column is non-repainting. Needs `rightbars` as a literal whole number |
| `ta.pivotlow` | 16.4% | 236 | 328 | `partial` | — | `pivotlow(src,L,R)[R]` | — | as `ta.pivothigh` |
| `math.round` | 16.1% | 233 | 854 | `supported` | — | `round` | — | name and arity line up with the table |
| `ta.ema` | 16.0% | 231 | 764 | `supported` | — | `ema` | — | name and arity line up with the table |
| `math.avg` | 14.8% | 213 | 747 | `supported` | — | `avg (expanded)` | — | expanded to declared primitives |
| `request.security` | 12.9% | 186 | 913 | `partial` | `pine:request` | `tf / sym nodes` | — | THIS symbol at a resampled W/M timeframe translates to `tf`; a literal OTHER ticker to `sym` (benchmark roster only). Everything else — computed symbol, unservable tf, `lookahead_on`, a tuple return — refuses |
| `bare:sma` | 12.8% | 184 | 486 | `supported` | — | `sma` | — | the bare spelling reaches the table directly |
| `color.from_gradient` | 11.5% | 166 | 421 | `ignored` | `pine:colour-value` | — | — | a colour is never a column — but it is IGNORED in a presentation argument, so it only refuses if a screened value flows through it |
| `bare:ema` | 11.4% | 165 | 713 | `supported` | — | `ema` | — | the bare spelling reaches the table directly |
| `ta.change` | 11.2% | 162 | 502 | `supported` | — | `change` | — | name and arity line up with the table |
| `input.timeframe` | 10.7% | 154 | 427 | `partial` | `pine:input-kind` | `folded as a FIXED STRING (stringValueOf)` | — | refuses as a NUMERIC value, but IS read as a fixed string — it folds a `switch` subject and supplies `request.security`'s timeframe or symbol |
| `feat:alert_calls` | 10.5% | 151 | 587 | `ignored` | — | — | — | `alert()` is in CHART_ONLY_CALLS — noted, never refused, never a column |
| `array.set` | 10.2% | 147 | 1347 | `absent` | `pine:collection` | — | 147 | no collection node in the expression grammar |
| `array.new_line` | 10.0% | 145 | 421 | `absent` | `pine:collection` | — | 145 | no collection node in the expression grammar |
| `array.new_int` | 9.8% | 142 | 468 | `absent` | `pine:collection` | — | 142 | no collection node in the expression grammar |
| `feat:methods` | 9.6% | 139 | 582 | `absent` | `pine:type` | — | 139 | UDT methods ride on `type`, which is absent |
| `input.source` | 8.9% | 129 | 212 | `supported` | — | `folded to its default` | — | folded to the author default (or the member override inside the author's bounds) |
| `feat:while_loops` | 8.6% | 124 | 334 | `absent` | `pine:block` | — | 124 | no loop node |
| `feat:imports` | 8.5% | 123 | 246 | `absent` | `pine:module` | — | 123 | the imported library body is code this engine never sees |
| `bare:change` | 8.2% | 118 | 368 | `supported` | — | `change` | — | the bare spelling reaches the table directly |
| `array.remove` | 7.6% | 110 | 1066 | `absent` | `pine:collection` | — | 110 | no collection node in the expression grammar |
| `array.new_box` | 7.6% | 110 | 286 | `absent` | `pine:collection` | — | 110 | no collection node in the expression grammar |
| `ta.stdev` | 7.6% | 109 | 155 | `supported` | — | `stdev` | — | name and arity line up with the table |
| `ta.rsi` | 7.4% | 107 | 166 | `supported` | — | `rsi` | — | name and arity line up with the table |
| `array.shift` | 7.3% | 106 | 585 | `absent` | `pine:collection` | — | 106 | no collection node in the expression grammar |
| `array.from` | 7.3% | 105 | 428 | `absent` | `pine:collection` | — | 105 | no collection node in the expression grammar |
| `timeframe.in_seconds` | 7.0% | 101 | 317 | `absent` | `pine:builtin` | — | 101 | the CLOCK section declares isdaily/isintraday/isweekly/ismonthly, but the `timeframe.*` SPELLING is refused — `timeframe.in_seconds`/`.change` have no node |
| `math.floor` | 7.0% | 101 | 249 | `absent` | `pine:function` | — | 101 | the table declares no such function |
| `ta.valuewhen` | 6.9% | 100 | 711 | `refused` | `pine:function` | — | 100 | DELIBERATE RULING — Pine's 3rd arg counts OCCURRENCES, ours is a BAR WINDOW; they line up positionally and answer different numbers |
| `bare:security` | 6.9% | 99 | 492 | `refused` | `pine:request` | — | 99 | v2–v4 spelling of `request.security`; same guard |
| `bare:highest` | 6.9% | 99 | 192 | `supported` | — | `highest` | — | the bare spelling reaches the table directly |
| `math.pow` | 6.8% | 98 | 332 | `supported` | — | `pow (measured shape)` | — | a MEASURED argument permutation in PINE_CALL_SHAPES |
| `ta.rma` | 6.7% | 96 | 204 | `supported` | — | `rma` | — | name and arity line up with the table |
| `bare:lowest` | 6.7% | 96 | 188 | `supported` | — | `lowest` | — | the bare spelling reaches the table directly |
| `ta.wma` | 6.5% | 94 | 226 | `supported` | — | `wma` | — | name and arity line up with the table |
| `bare:crossover` | 5.6% | 81 | 166 | `supported` | — | `crossOver` | — | the bare spelling reaches the table directly |
| `array.new_label` | 5.5% | 79 | 190 | `absent` | `pine:collection` | — | 79 | no collection node in the expression grammar |
| `strategy.entry` | 5.3% | 77 | 165 | `refused` | `pine:strategy-call` | — | 77 | DELIBERATE RULING — an order-placing call answers with no value a screen could filter |
| `math.sqrt` | 5.3% | 77 | 140 | `supported` | — | `sqrt` | — | name and arity line up with the table |
| `bare:crossunder` | 5.1% | 74 | 142 | `supported` | — | `crossUnder` | — | the bare spelling reaches the table directly |
| `ta.barssince` | 5.0% | 72 | 227 | `refused` | `pine:function` | — | 72 | DELIBERATE RULING — Pine is unbounded, ours saturates at a window; the `ta.barssince(c) < K` form IS rewritten and translates |
| `bare:iff` | 4.9% | 71 | 267 | `supported` | — | `iff (expanded)` | — | expanded to declared primitives |
| `bare:rsi` | 4.9% | 70 | 103 | `supported` | — | `rsi` | — | the bare spelling reaches the table directly |
| `array.unshift` | 4.8% | 69 | 397 | `absent` | `pine:collection` | — | 69 | no collection node in the expression grammar |
| `array.clear` | 4.8% | 69 | 276 | `absent` | `pine:collection` | — | 69 | no collection node in the expression grammar |
| `array.max` | 4.6% | 66 | 149 | `absent` | `pine:collection` | — | 66 | no collection node in the expression grammar |
| `input.session` | 4.4% | 63 | 217 | `refused` | `pine:input-kind` | — | 63 | a non-numeric input carries a default the grammar cannot hold (fires only if a screened value actually reads it) |
| `bare:stdev` | 4.4% | 63 | 93 | `supported` | — | `stdev` | — | the bare spelling reaches the table directly |
| `bare:valuewhen` | 4.2% | 61 | 458 | `supported` | — | `valuewhen` | — | the bare spelling reaches the table directly |
| `str.format` | 4.2% | 60 | 278 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `math.exp` | 4.2% | 61 | 151 | `supported` | — | `exp` | — | name and arity line up with the table |
| `ta.hma` | 4.0% | 58 | 78 | `supported` | — | `hma` | — | name and arity line up with the table |
| `math.sign` | 3.9% | 56 | 279 | `supported` | — | `sign` | — | name and arity line up with the table |
| `math.sum` | 3.9% | 56 | 129 | `supported` | — | `sum` | — | name and arity line up with the table |
| `array.pop` | 3.7% | 54 | 240 | `absent` | `pine:collection` | — | 54 | no collection node in the expression grammar |
| `timeframe.change` | 3.7% | 54 | 141 | `absent` | `pine:builtin` | — | 54 | the CLOCK section declares isdaily/isintraday/isweekly/ismonthly, but the `timeframe.*` SPELLING is refused — `timeframe.in_seconds`/`.change` have no node |
| `bare:atr` | 3.7% | 53 | 105 | `supported` | — | `atr` | — | the bare spelling reaches the table directly |
| `request.security_lower_tf` | 3.7% | 54 | 79 | `partial` | `pine:request` | `tf / sym nodes` | — | THIS symbol at a resampled W/M timeframe translates to `tf`; a literal OTHER ticker to `sym` (benchmark roster only). Everything else — computed symbol, unservable tf, `lookahead_on`, a tuple return — refuses |
| `ta.vwma` | 3.5% | 51 | 78 | `partial` | — | `vwma (expanded)` | — | expanded to sma(src*vol,n)/sma(vol,n); n must be a literal int |
| `ta.cross` | 3.4% | 49 | 121 | `supported` | — | `cross (expanded)` | — | expanded to declared primitives |
| `ta.cum` | 3.1% | 45 | 68 | `refused` | `pine:function` | — | 45 | DELIBERATE RULING — an unanchored running total; `cumFrom(src, anchor, window)` is offered instead |
| `str.contains` | 3.0% | 43 | 219 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `math.log` | 3.0% | 43 | 142 | `supported` | — | `log (measured shape)` | — | a MEASURED argument permutation in PINE_CALL_SHAPES |
| `bare:rma` | 3.0% | 43 | 113 | `supported` | — | `rma` | — | the bare spelling reaches the table directly |
| `array.new_string` | 3.0% | 43 | 93 | `absent` | `pine:collection` | — | 43 | no collection node in the expression grammar |
| `bare:wma` | 2.9% | 42 | 192 | `supported` | — | `wma` | — | the bare spelling reaches the table directly |
| `strategy.close` | 2.9% | 42 | 89 | `refused` | `pine:strategy-call` | — | 42 | DELIBERATE RULING — an order-placing call answers with no value a screen could filter |
| `input.time` | 2.9% | 42 | 74 | `refused` | `pine:input-kind` | — | 42 | a non-numeric input carries a default the grammar cannot hold (fires only if a screened value actually reads it) |
| `runtime.error` | 2.9% | 42 | 64 | `absent` | `pine:builtin` | — | 42 | the whole namespace refuses under one entry |
| `str.substring` | 2.8% | 40 | 162 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `str.tonumber` | 2.7% | 39 | 117 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `array.indexof` | 2.6% | 38 | 84 | `absent` | `pine:collection` | — | 38 | no collection node in the expression grammar |
| `bare:cross` | 2.6% | 37 | 79 | `supported` | — | `cross (expanded)` | — | expanded to declared primitives |
| `array.sum` | 2.5% | 36 | 153 | `absent` | `pine:collection` | — | 36 | no collection node in the expression grammar |
| `str.length` | 2.4% | 34 | 133 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `ta.linreg` | 2.4% | 34 | 91 | `partial` | — | `linreg (expanded)` | — | expanded in closed form; length and offset must be literal |
| `bare:sum` | 2.4% | 34 | 82 | `supported` | — | `sum` | — | the bare spelling reaches the table directly |
| `bare:barssince` | 2.4% | 35 | 72 | `supported` | — | `barssince` | — | the bare spelling reaches the table directly |
| `bare:stoch` | 2.4% | 35 | 47 | `supported` | — | `stoch` | — | the bare spelling reaches the table directly |
| `array.min` | 2.3% | 33 | 72 | `absent` | `pine:collection` | — | 33 | no collection node in the expression grammar |
| `ta.vwap` | 2.3% | 33 | 69 | `partial` | — | `vwap()` | — | the ZERO-ARGUMENT variable form reaches the table and works; the ONE-ARGUMENT `ta.vwap(src)` form refuses, because a shape carries one `pineArity` and declaring the 1-arg form would refuse the spelling members actually write |
| `bare:pivothigh` | 2.3% | 33 | 43 | `supported` | — | `pivothigh` | — | the bare spelling reaches the table directly |
| `bare:pivotlow` | 2.3% | 33 | 43 | `supported` | — | `pivotlow` | — | the bare spelling reaches the table directly |
| `math.ceil` | 2.2% | 32 | 65 | `absent` | `pine:function` | — | 32 | the table declares no such function |
| `array.insert` | 2.1% | 30 | 204 | `absent` | `pine:collection` | — | 30 | no collection node in the expression grammar |
| `ta.supertrend` | 2.1% | 30 | 137 | `absent` | `pine:function` | — | 30 | the table declares no such function |
| `strategy.exit` | 2.1% | 30 | 105 | `refused` | `pine:strategy-call` | — | 30 | DELIBERATE RULING — an order-placing call answers with no value a screen could filter |
| `str.split` | 2.0% | 29 | 52 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `array.new_bool` | 1.9% | 28 | 172 | `absent` | `pine:collection` | — | 28 | no collection node in the expression grammar |
| `ta.stoch` | 1.9% | 28 | 37 | `supported` | — | `stoch (measured permutation)` | — | SUPPORTED only because the permutation was MEASURED. Pine's `ta.stoch(source, high, low, n)` mapped verbatim onto our `stoch(h, l, c, n)` produced a plausible number and was WRONG BY 126 POINTS of a 0-100 oscillator |
| `input.symbol` | 1.8% | 26 | 354 | `partial` | `pine:input-kind` | `folded as a FIXED STRING (stringValueOf)` | — | refuses as a NUMERIC value, but IS read as a fixed string — it folds a `switch` subject and supplies `request.security`'s timeframe or symbol |
| `bare:cum` | 1.8% | 26 | 43 | `refused` | `pine:function` | — | 26 | DELIBERATE RULING — an unanchored running total; `cumFrom(src, anchor, window)` is offered instead |
| `bare:vwma` | 1.8% | 26 | 37 | `partial` | — | `vwma (expanded)` | — | expanded to sma(src*vol,n)/sma(vol,n); n must be a literal int |
| `math.round_to_mintick` | 1.7% | 25 | 269 | `absent` | `pine:function` | — | 25 | the table declares no such function |
| `math.cos` | 1.7% | 25 | 57 | `supported` | — | `cos` | — | name and arity line up with the table |
| `array.copy` | 1.7% | 25 | 50 | `absent` | `pine:collection` | — | 25 | no collection node in the expression grammar |
| `ta.highestbars` | 1.7% | 24 | 43 | `partial` | — | `-highestbars(src,n)` | — | EXACT IDENTITY via the declared `u-` operator: Pine returns a NON-POSITIVE offset, ours the POSITIVE distance |
| `ta.lowestbars` | 1.7% | 24 | 43 | `partial` | — | `-lowestbars(src,n)` | — | as `ta.highestbars` |
| `input.enum` | 1.6% | 23 | 102 | `refused` | `pine:input-kind` | — | 23 | a non-numeric input carries a default the grammar cannot hold (fires only if a screened value actually reads it) |
| `array.avg` | 1.6% | 23 | 44 | `absent` | `pine:collection` | — | 23 | no collection node in the expression grammar |
| `ta.tr` | 1.6% | 23 | 40 | `supported` | — | `tr (expanded)` | — | expanded to declared primitives |
| `bare:linreg` | 1.5% | 22 | 53 | `partial` | — | `linreg (expanded)` | — | expanded in closed form; length and offset must be literal |
| `bare:cci` | 1.5% | 21 | 29 | `supported` | — | `cci` | — | the bare spelling reaches the table directly |
| `color.r` | 1.5% | 22 | 28 | `ignored` | `pine:colour-value` | — | — | a colour is never a column — but it is IGNORED in a presentation argument, so it only refuses if a screened value flows through it |
| `matrix.get` | 1.3% | 19 | 216 | `absent` | `pine:collection` | — | 19 | no collection node in the expression grammar |
| `array.sort` | 1.3% | 19 | 26 | `absent` | `pine:collection` | — | 19 | no collection node in the expression grammar |
| `color.b` | 1.3% | 19 | 25 | `ignored` | `pine:colour-value` | — | — | a colour is never a column — but it is IGNORED in a presentation argument, so it only refuses if a screened value flows through it |
| `color.g` | 1.3% | 19 | 25 | `ignored` | `pine:colour-value` | — | — | a colour is never a column — but it is IGNORED in a presentation argument, so it only refuses if a screened value flows through it |
| `ta.macd` | 1.3% | 19 | 23 | `supported` | — | `macd` | — | name and arity line up with the table |
| `ta.dmi` | 1.3% | 19 | 20 | `absent` | `pine:function` | — | 19 | the table declares no such function |
| `feat:varip_decls` | 1.2% | 17 | 120 | `refused` | `pine:state` | — | 17 | DELIBERATE RULING — `varip` persists across INTRABAR TICKS, so its value depends on how many times a forming bar updated |
| `math.sin` | 1.2% | 17 | 46 | `supported` | — | `sin` | — | name and arity line up with the table |
| `input.text_area` | 1.2% | 18 | 40 | `ignored` | `pine:input-kind` | — | — | a colour/tooltip knob is only ever read by a presentation argument, which the translator never walks — the binding is marked opaque and never reached |
| `array.new_color` | 1.2% | 17 | 18 | `absent` | `pine:collection` | — | 17 | no collection node in the expression grammar |
| `str.pos` | 1.1% | 16 | 71 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `matrix.set` | 1.0% | 14 | 183 | `absent` | `pine:collection` | — | 14 | no collection node in the expression grammar |
| `str.replace_all` | 1.0% | 14 | 63 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `str.replace` | 1.0% | 14 | 46 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `str.lower` | 1.0% | 14 | 31 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `ta.alma` | 1.0% | 14 | 19 | `absent` | `pine:function` | — | 14 | the table declares no such function |
| `color.t` | 1.0% | 14 | 18 | `ignored` | `pine:colour-value` | — | — | a colour is never a column — but it is IGNORED in a presentation argument, so it only refuses if a screened value flows through it |
| `matrix.rows` | 0.9% | 13 | 34 | `absent` | `pine:collection` | — | 13 | no collection node in the expression grammar |
| `array.fill` | 0.9% | 13 | 34 | `absent` | `pine:collection` | — | 13 | no collection node in the expression grammar |
| `array.includes` | 0.9% | 13 | 28 | `absent` | `pine:collection` | — | 13 | no collection node in the expression grammar |
| `array.new_linefill` | 0.9% | 13 | 14 | `absent` | `pine:collection` | — | 13 | no collection node in the expression grammar |
| `bare:hma` | 0.8% | 11 | 27 | `supported` | — | `hma` | — | the bare spelling reaches the table directly |
| `ta.mfi` | 0.8% | 12 | 23 | `partial` | — | `mfi (shape + sourceMustBe)` | — | same as `ta.cci`: only when the source IS `hlc3` |
| `ta.correlation` | 0.8% | 12 | 21 | `absent` | `pine:function` | — | 12 | the table declares no such function |
| `array.slice` | 0.8% | 11 | 21 | `absent` | `pine:collection` | — | 11 | no collection node in the expression grammar |
| `ta.cci` | 0.8% | 11 | 14 | `partial` | — | `cci (shape + sourceMustBe)` | — | resolves ONLY when the source argument IS `hlc3` — the shipped `computeCCI` reads the typical price, so `ta.cci(close, 20)` is a different indicator and refuses rather than silently answering the typical-price column |
| `ticker.heikinashi` | 0.7% | 10 | 32 | `partial` | `pine:builtin` | `seen through for the chart's own symbol` | — | `ticker.new`/`tickerid` are seen through when they wrap THIS symbol; `heikinashi`/`renko`/`inherit` refuse |
| `ta.rising` | 0.7% | 10 | 31 | `absent` | `pine:function` | — | 10 | the table declares no such function |
| `math.atan` | 0.7% | 10 | 17 | `supported` | — | `atan` | — | name and arity line up with the table |
| `timeframe.from_seconds` | 0.7% | 10 | 12 | `absent` | `pine:builtin` | — | 10 | the CLOCK section declares isdaily/isintraday/isweekly/ismonthly, but the `timeframe.*` SPELLING is refused — `timeframe.in_seconds`/`.change` have no node |
| `str.repeat` | 0.6% | 9 | 39 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `str.format_time` | 0.6% | 9 | 26 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `ta.falling` | 0.6% | 8 | 26 | `absent` | `pine:function` | — | 8 | the table declares no such function |
| `bare:vwap` | 0.6% | 8 | 16 | `supported` | — | `vwap` | — | the bare spelling reaches the table directly |
| `ta.bb` | 0.6% | 9 | 15 | `absent` | `pine:function` | — | 9 | the table declares no such function |
| `bare:tr` | 0.6% | 9 | 12 | `supported` | — | `tr (expanded)` | — | expanded to declared primitives |
| `bare:macd` | 0.6% | 8 | 12 | `supported` | — | `macd` | — | the bare spelling reaches the table directly |
| `ta.percentile_nearest_rank` | 0.6% | 8 | 12 | `absent` | `pine:function` | — | 8 | the table declares no such function |
| `strategy.close_all` | 0.6% | 9 | 11 | `refused` | `pine:strategy-call` | — | 9 | DELIBERATE RULING — an order-placing call answers with no value a screen could filter |
| `ta.sar` | 0.6% | 8 | 8 | `absent` | `pine:function` | — | 8 | the table declares no such function |
| `math.random` | 0.5% | 7 | 17 | `absent` | `pine:function` | — | 7 | the table declares no such function |
| `array.join` | 0.5% | 7 | 12 | `absent` | `pine:collection` | — | 7 | no collection node in the expression grammar |
| `ta.swma` | 0.5% | 7 | 7 | `absent` | `pine:function` | — | 7 | the table declares no such function |
| `ta.max` | 0.5% | 7 | 7 | `supported` | — | `max (measured shape)` | — | a MEASURED argument permutation in PINE_CALL_SHAPES |
| `strategy.cancel` | 0.4% | 6 | 23 | `refused` | `pine:strategy-call` | — | 6 | DELIBERATE RULING — an order-placing call answers with no value a screen could filter |
| `str.startswith` | 0.4% | 6 | 14 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `array.concat` | 0.4% | 6 | 13 | `absent` | `pine:collection` | — | 6 | no collection node in the expression grammar |
| `array.median` | 0.4% | 6 | 11 | `absent` | `pine:collection` | — | 6 | no collection node in the expression grammar |
| `matrix.add_row` | 0.4% | 6 | 11 | `absent` | `pine:collection` | — | 6 | no collection node in the expression grammar |
| `ta.roc` | 0.4% | 6 | 8 | `partial` | — | `roc (expanded)` | — | expanded to 100*(src-src[n])/src[n]; n must be a literal |
| `ta.mom` | 0.4% | 6 | 8 | `partial` | — | `mom (expanded)` | — | expanded to src - src[n]; n must be a literal |
| `array.stdev` | 0.4% | 6 | 7 | `absent` | `pine:collection` | — | 6 | no collection node in the expression grammar |
| `array.last` | 0.3% | 5 | 40 | `absent` | `pine:collection` | — | 5 | no collection node in the expression grammar |
| `math.toradians` | 0.3% | 5 | 24 | `absent` | `pine:function` | — | 5 | the table declares no such function |
| `str.trim` | 0.3% | 4 | 13 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `str.upper` | 0.3% | 5 | 12 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `str.match` | 0.3% | 4 | 12 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `input.price` | 0.3% | 5 | 11 | `supported` | — | `folded to its default` | — | folded to the author default (or the member override inside the author's bounds) |
| `math.log10` | 0.3% | 4 | 11 | `supported` | — | `log10` | — | name and arity line up with the table |
| `ta.percentrank` | 0.3% | 5 | 6 | `absent` | `pine:function` | — | 5 | the table declares no such function |
| `matrix.columns` | 0.3% | 4 | 6 | `absent` | `pine:collection` | — | 4 | no collection node in the expression grammar |
| `ta.median` | 0.3% | 4 | 6 | `absent` | `pine:function` | — | 4 | the table declares no such function |
| `matrix.remove_row` | 0.3% | 4 | 6 | `absent` | `pine:collection` | — | 4 | no collection node in the expression grammar |
| `ta.dev` | 0.3% | 4 | 6 | `supported` | — | `dev` | — | name and arity line up with the table |
| `ta.requestUpAndDownVolume` | 0.3% | 5 | 5 | `absent` | `pine:function` | — | 5 | the table declares no such function |
| `ta.percentile_linear_interpolation` | 0.3% | 5 | 5 | `absent` | `pine:function` | — | 5 | the table declares no such function |
| `ta.min` | 0.3% | 5 | 5 | `supported` | — | `min (measured shape)` | — | a MEASURED argument permutation in PINE_CALL_SHAPES |
| `array.lastindexof` | 0.3% | 4 | 5 | `absent` | `pine:collection` | — | 4 | no collection node in the expression grammar |
| `bare:dev` | 0.3% | 4 | 5 | `supported` | — | `dev` | — | the bare spelling reaches the table directly |
| `array.reverse` | 0.3% | 4 | 5 | `absent` | `pine:collection` | — | 4 | no collection node in the expression grammar |
| `request.earnings` | 0.3% | 4 | 4 | `partial` | `pine:request` | `tf / sym nodes` | — | THIS symbol at a resampled W/M timeframe translates to `tf`; a literal OTHER ticker to `sym` (benchmark roster only). Everything else — computed symbol, unservable tf, `lookahead_on`, a tuple return — refuses |
| `request.dividends` | 0.3% | 4 | 4 | `partial` | `pine:request` | `tf / sym nodes` | — | THIS symbol at a resampled W/M timeframe translates to `tf`; a literal OTHER ticker to `sym` (benchmark roster only). Everything else — computed symbol, unservable tf, `lookahead_on`, a tuple return — refuses |
| `request.splits` | 0.3% | 4 | 4 | `partial` | `pine:request` | `tf / sym nodes` | — | THIS symbol at a resampled W/M timeframe translates to `tf`; a literal OTHER ticker to `sym` (benchmark roster only). Everything else — computed symbol, unservable tf, `lookahead_on`, a tuple return — refuses |
| `str.endswith` | 0.3% | 4 | 4 | `ignored` | `pine:builtin` | — | — | text is never a column; ignored inside labels/tables, refuses if a value flows through it |
| `ticker.new` | 0.2% | 3 | 8 | `partial` | `pine:builtin` | `seen through for the chart's own symbol` | — | `ticker.new`/`tickerid` are seen through when they wrap THIS symbol; `heikinashi`/`renko`/`inherit` refuse |
| `array.binary_search_rightmost` | 0.2% | 3 | 7 | `absent` | `pine:collection` | — | 3 | no collection node in the expression grammar |
| `bare:obv` | 0.2% | 3 | 6 | `absent` | `pine:function` | — | 3 | no table entry and no expansion |
| `bare:supertrend` | 0.2% | 3 | 6 | `absent` | `pine:function` | — | 3 | no table entry and no expansion |
| `array.first` | 0.2% | 3 | 5 | `absent` | `pine:collection` | — | 3 | no collection node in the expression grammar |
| `syminfo.ticker` | 0.2% | 3 | 4 | `absent` | `pine:builtin` | — | 3 | `syminfo.tickerid`/`.ticker` are seen through as "this symbol" inside a request; every other member (mintick, prefix, type…) refuses |
| `ta.variance` | 0.2% | 3 | 3 | `absent` | `pine:function` | — | 3 | the table declares no such function |
| `ta.dema` | 0.2% | 3 | 3 | `absent` | `pine:function` | — | 3 | the table declares no such function |
| `bare:mfi` | 0.2% | 3 | 3 | `supported` | — | `mfi` | — | the bare spelling reaches the table directly |
| `ta.cog` | 0.2% | 3 | 3 | `absent` | `pine:function` | — | 3 | the table declares no such function |
| `ta.wpr` | 0.2% | 3 | 3 | `supported` | — | `wpr (measured shape)` | — | a MEASURED argument permutation in PINE_CALL_SHAPES |
| `ta.kc` | 0.2% | 3 | 3 | `absent` | `pine:function` | — | 3 | the table declares no such function |
| `ticker.standard` | 0.1% | 2 | 12 | `partial` | `pine:builtin` | `seen through for the chart's own symbol` | — | `ticker.new`/`tickerid` are seen through when they wrap THIS symbol; `heikinashi`/`renko`/`inherit` refuse |
| `array.percentile_nearest_rank` | 0.1% | 2 | 7 | `absent` | `pine:collection` | — | 2 | no collection node in the expression grammar |
| `array.percentrank` | 0.1% | 2 | 7 | `absent` | `pine:collection` | — | 2 | no collection node in the expression grammar |
| `strategy.order` | 0.1% | 1 | 6 | `refused` | `pine:strategy-call` | — | 1 | DELIBERATE RULING — an order-placing call answers with no value a screen could filter |
| `ticker.inherit` | 0.1% | 1 | 6 | `partial` | `pine:builtin` | `seen through for the chart's own symbol` | — | `ticker.new`/`tickerid` are seen through when they wrap THIS symbol; `heikinashi`/`renko`/`inherit` refuse |
| `matrix.min` | 0.1% | 2 | 5 | `absent` | `pine:collection` | — | 2 | no collection node in the expression grammar |
| `matrix.mult` | 0.1% | 2 | 5 | `absent` | `pine:collection` | — | 2 | no collection node in the expression grammar |
| `matrix.max` | 0.1% | 2 | 4 | `absent` | `pine:collection` | — | 2 | no collection node in the expression grammar |
| `math.asin` | 0.1% | 2 | 4 | `absent` | `pine:function` | — | 2 | the table declares no such function |
| `array.binary_search_leftmost` | 0.1% | 2 | 4 | `absent` | `pine:collection` | — | 2 | no collection node in the expression grammar |
| `ta.t3` | 0.1% | 2 | 3 | `absent` | `pine:function` | — | 2 | the table declares no such function |
| `math.acos` | 0.1% | 2 | 3 | `absent` | `pine:function` | — | 2 | the table declares no such function |
| `bare:roc` | 0.1% | 2 | 3 | `partial` | — | `roc (expanded)` | — | expanded to 100*(src-src[n])/src[n]; n must be a literal |
| `map.values` | 0.1% | 2 | 3 | `absent` | `pine:collection` | — | 2 | no collection node in the expression grammar |
| `session.new` | 0.1% | 2 | 3 | `absent` | `pine:builtin` | — | 2 | the whole namespace refuses under one entry |
| `array.percentile_linear_interpolation` | 0.1% | 1 | 3 | `absent` | `pine:collection` | — | 1 | no collection node in the expression grammar |
| `array.sort_indices` | 0.1% | 2 | 2 | `absent` | `pine:collection` | — | 2 | no collection node in the expression grammar |
| `strategy.cancel_all` | 0.1% | 2 | 2 | `refused` | `pine:strategy-call` | — | 2 | DELIBERATE RULING — an order-placing call answers with no value a screen could filter |
| `ta.tsi` | 0.1% | 2 | 2 | `absent` | `pine:function` | — | 2 | the table declares no such function |
| `matrix.col` | 0.1% | 2 | 2 | `absent` | `pine:collection` | — | 2 | no collection node in the expression grammar |
| `ta.requestVolumeDelta` | 0.1% | 2 | 2 | `absent` | `pine:function` | — | 2 | the table declares no such function |
| `ta.cmo` | 0.1% | 2 | 2 | `absent` | `pine:function` | — | 2 | the table declares no such function |
| `math.tan` | 0.1% | 2 | 2 | `supported` | — | `tan` | — | name and arity line up with the table |
| `matrix.add_col` | 0.1% | 2 | 2 | `absent` | `pine:collection` | — | 2 | no collection node in the expression grammar |
| `ta.frama` | 0.1% | 1 | 2 | `absent` | `pine:function` | — | 1 | the table declares no such function |
| `array.mode` | 0.1% | 1 | 2 | `absent` | `pine:collection` | — | 1 | no collection node in the expression grammar |
| `ta.lowestSince` | 0.1% | 1 | 2 | `absent` | `pine:function` | — | 1 | the table declares no such function |
| `ta.highestSince` | 0.1% | 1 | 2 | `absent` | `pine:function` | — | 1 | the table declares no such function |
| `ta.bbw` | 0.1% | 1 | 2 | `absent` | `pine:function` | — | 1 | the table declares no such function |
| `array.standardize` | 0.1% | 1 | 2 | `absent` | `pine:collection` | — | 1 | no collection node in the expression grammar |
| `matrix.row` | 0.1% | 1 | 1 | `absent` | `pine:collection` | — | 1 | no collection node in the expression grammar |
| `matrix.submatrix` | 0.1% | 1 | 1 | `absent` | `pine:collection` | — | 1 | no collection node in the expression grammar |
| `chart.leftBarIndex` | 0.1% | 1 | 1 | `absent` | `pine:builtin` | — | 1 | the whole namespace refuses under one entry |
| `chart.rightBarIndex` | 0.1% | 1 | 1 | `absent` | `pine:builtin` | — | 1 | the whole namespace refuses under one entry |
| `chart.bars` | 0.1% | 1 | 1 | `absent` | `pine:builtin` | — | 1 | the whole namespace refuses under one entry |
| `chart.isLastVisibleBar` | 0.1% | 1 | 1 | `absent` | `pine:builtin` | — | 1 | the whole namespace refuses under one entry |
| `chart.barIsVisible` | 0.1% | 1 | 1 | `absent` | `pine:builtin` | — | 1 | the whole namespace refuses under one entry |
| `syminfo.prefix` | 0.1% | 1 | 1 | `absent` | `pine:builtin` | — | 1 | `syminfo.tickerid`/`.ticker` are seen through as "this symbol" inside a request; every other member (mintick, prefix, type…) refuses |
| `matrix.remove_col` | 0.1% | 1 | 1 | `absent` | `pine:collection` | — | 1 | no collection node in the expression grammar |
| `ta.tema` | 0.1% | 1 | 1 | `absent` | `pine:function` | — | 1 | the table declares no such function |
| `math.pi` | 0.1% | 1 | 1 | `absent` | `pine:builtin` | — | 1 | a math constant with no declared name |
| `ta.aroon` | 0.1% | 1 | 1 | `absent` | `pine:function` | — | 1 | the table declares no such function |
| `ta.relativeVolume` | 0.1% | 1 | 1 | `absent` | `pine:function` | — | 1 | the table declares no such function |
| `matrix.transpose` | 0.1% | 1 | 1 | `absent` | `pine:collection` | — | 1 | no collection node in the expression grammar |
| `matrix.inv` | 0.1% | 1 | 1 | `absent` | `pine:collection` | — | 1 | no collection node in the expression grammar |
| `ta.pivot_point_levels` | 0.1% | 1 | 1 | `absent` | `pine:function` | — | 1 | the table declares no such function |
| `ticker.renko` | 0.1% | 1 | 1 | `partial` | `pine:builtin` | `seen through for the chart's own symbol` | — | `ticker.new`/`tickerid` are seen through when they wrap THIS symbol; `heikinashi`/`renko`/`inherit` refuse |
| `bare:sar` | 0.1% | 1 | 1 | `absent` | `pine:function` | — | 1 | no table entry and no expansion |
| `request.footprint` | 0.1% | 1 | 1 | `partial` | `pine:request` | `tf / sym nodes` | — | THIS symbol at a resampled W/M timeframe translates to `tf`; a literal OTHER ticker to `sym` (benchmark roster only). Everything else — computed symbol, unservable tf, `lookahead_on`, a tuple return — refuses |
| `math.todegrees` | 0.1% | 1 | 1 | `absent` | `pine:function` | — | 1 | the table declares no such function |
| `map.keys` | 0.1% | 1 | 1 | `absent` | `pine:collection` | — | 1 | no collection node in the expression grammar |

---

# TASK B — what actually blocks the wild

## Every refusal guard in one plain sentence, with what kind of gap it is

Script counts: **run-1** = the delivered `engine_refusal_agg.json` (467 judged, complete). **run-2** = my frozen snapshot (500 judged). **survey** = my per-script blocker model over all 1443 surveyed scripts (over-inclusive: it is not reachability-aware). **sole** = scripts in run-2 whose ONLY recorded guard is this one.

| guard | in plain English | kind of gap | run-1 | run-2 | sole | survey | note |
|---|---|---|---|---|---|---|---|
| `pine:no-output` | the script offers no plot and no alertcondition, so there is no column to filter on | **DELIBERATE RULING (product scope)** | 78 | 51 | 51 | 345 (23.9%) | NOT a renderer blocker at all — 22.9% of the corpus draws for a living |
| `pine:character` | the lexer met a character it has no rule for, and it aborts the whole file | **PARSER gap (lexer)** | 74 | 47 | 47 | 186 (12.9%) | see the diagnosis below — the class is a bare `.` and a newline inside a string |
| `pine:function` | the name is under `ta.`/`math.` and the closed table declares nothing that answers it | **VOCABULARY gap** | 27 | 30 | 14 | 409 (28.3%) | 45 distinct names; most are stateless arithmetic |
| `pine:builtin` | the name is under a namespace the door refuses wholesale (`timeframe.`, `syminfo.`, `str.`, `session.`, `chart.`, `runtime.`) | **VOCABULARY gap** | 16 | 30 | 12 | 154 (10.7%) | `timeframe.in_seconds` and `timeframe.change` are the two that actually matter |
| `pine:declaration-strategy` | the script is a backtest that places orders, and a screen filters symbols | **DELIBERATE RULING (product scope)** | 18 | 39 | 20 | 78 (5.4%) | 78 of 1,443; a renderer would draw every one of them |
| `pine:module` | the script imports another script, whose body this engine never fetched | **RUNTIME gap (+ an acquisition gap)** | 25 | 36 | 12 | 123 (8.5%) | 123 scripts, 246 import statements, 124 distinct libraries |
| `pine:tuple` | the call answers with several values at once and a screened column carries one | **RUNTIME gap (output shape)** | 29 | 27 | 8 | 139 (9.6%) | `[a,b] = f()` destructuring, `ta.macd`, `ta.bb`, `request.security` tuples |
| `pine:request` | the request could not be folded to ONE symbol and ONE servable timeframe | **RUNTIME gap (a second feed) + partly DELIBERATE** | 15 | 25 | 17 | 333 (23.1%) | THIS symbol at W/M resamples today (`tf`); a literal other ticker becomes `sym` on the benchmark roster |
| `pine:state` | the value carries forward in a way the bounded accumulator cannot hold | **DELIBERATE RULING, explicitly NOT a backlog item** | 34 | 21 | 16 | 17 (1.2%) | ⚠️ THE SURVEY COLUMN UNDER-COUNTS THIS BADLY: it can only see `varip` (1.2%). The engine's 21–34 scripts also include unbounded `var` accumulators, which the feature vector cannot distinguish from the 65.6% of scripts whose `var` DOES translate as `accum`. Rationale: an unbounded accumulator would end static decidability — `maxLookback` could no longer be a tree sum |
| `pine:arity` | the table declares a different number of arguments for that name | **VOCABULARY gap (signature)** | 15 | 10 | 5 | — | the name resolves and the argument COUNT does not; closed one at a time by declaring a MEASURED `build` in `PINE_CALL_SHAPES` (that is how `ta.atr` and `ta.wpr` were closed) |
| `pine:block` | the construct spans several statements and this engine stores a single expression | **RUNTIME gap (no loop node)** | 18 | 18 | 10 | 679 (47.1%) | a bare `if` chain and a fixed-subject `switch` DO fold; `for`/`while` have no node at all |
| `pine:strategy-call` | an order-placing call answers with no value a screen could filter | **DELIBERATE RULING** | 6 | 17 | — | 78 (5.4%) | always co-occurs with pine:declaration-strategy in this corpus |
| `pine:reassign` | a name that is written again later cannot be folded into one expression | **RUNTIME gap (single-expression store)** | 23 | 8 | 4 | — | distinct from `var`: a plain `x = …` then `x := …` outside an if-fold |
| `pine:role-order` | the table says what KIND each argument is and never what ROLE it plays, so several price series cannot be matched by position | **RESEARCH gap** | 10 | 13 | 8 | — | unblocked one function at a time by a MEASURED permutation in PINE_CALL_SHAPES |
| `pine:statement` | this line is not a shape the translator reads | **PARSER gap** | 5 | 9 | 5 | — | the residual catch-all; each instance is its own small parse hole |
| `pine:collection` | an array, a matrix or a map is outside the expression grammar | **RUNTIME gap (no collection node)** | 10 | 8 | 7 | 508 (35.2%) | 508 of 1,443 scripts touch one; 21,854 call sites |
| `pine:function-def` | a function name is being read as a value rather than called | **PARSER gap** | 14 | 8 | 4 | — | UDF DEFINITIONS themselves are supported — they are inlined |
| `pine:type` | a user-defined type is outside the node shapes this engine stores | **RUNTIME gap (no UDT node)** | 10 | 10 | 1 | 294 (20.4%) | `type`/`method`/`enum`; 294 scripts |
| `pine:na` | this fills a gap by carrying an earlier bar's value forward, which needs a per-bar memory | **RUNTIME gap** | 6 | 6 | 1 | — | measured to fire for exactly one name: `fixnan` |
| `pine:plot-offset` | a plot displacement did not reduce to a whole number of bars at translation time | **PARSER gap (constant folding)** | 10 | 6 | 1 | — | a POSITIVE literal displacement translates to an `offset` node |
| `pine:undefined` | a name was never given a value in the pasted script | **SOURCE defect (or a binding the walk missed)** | 2 | 5 | 2 | — | usually a truncated paste |
| `pine:text-value` | text cannot be a value in a screened column | **DELIBERATE RULING** | 2 | 4 | 2 | — | mandatory for a renderer (labels, tables); free for a screener |
| `pine:colour-value` | a colour cannot be a value in a screened column | **DELIBERATE RULING** | — | — | — | — | ditto — `color.new` is in 59.3% of scripts and blocks none of them |
| `pine:offset-literal` | a bar offset has to be a plain whole number written into the script | **PARSER gap (constant folding)** | 6 | 3 | 1 | — | also: only ONE `[…]` per value |
| `pine:roundtrip` | the translator wrote formula text it could not read back, so it emitted none | **ENGINE DEFECT (our bug)** | 2 | 2 | 1 | — | the only guard on this list that is not a gap but a fault |
| `pine:cycle` | the name is defined in terms of itself | **SOURCE defect / recursion depth** | 2 | 1 | 1 | — | Pine forbids recursion; this also catches MAX_CALL_DEPTH |
| `pine:operator` | the operator has no counterpart this door is sure of | **RESEARCH gap** | 2 | — | — | — | `%` maps to `mod` but Pine does not publish how it rounds a NEGATIVE operand |
| `pine:window` | a length has to reach the engine as a plain whole number | **PARSER gap (folding)** | 2 | — | — | — |  |
| `pine:input-kind` | this input carries a default the grammar cannot hold | **VOCABULARY gap / RULING** | — | — | — | — | numeric kinds fold; a string folds as a fixed string; a colour is never read |

## ⭐⭐ THE `pine:character` DIAGNOSIS — the exact character class

`pine:character` was flagged as blocking ~16% of scripts and looking like a lexer issue. It is a lexer issue, and the class is now named exactly. I rebuilt `lexPine`'s character acceptance as an independent replica (`_lane2/charclass.py`) and ran it over all 2512 `.pine` files then present. **Agreement with the engine is exact: of the 47 scripts the engine refuses at `pine:character` in the frozen run, the replica flags 47 — and it flags zero scripts the engine gave a different verdict.** All counts below are then pinned to the 1443 SURVEYED slugs, which is a stable set (`acq/sources/` was still growing while this ran).

### What the lexer accepts

Whitespace, `//` to end of line, `#` + hex, a quoted string with no newline in it, digits, `[A-Za-z_][A-Za-z0-9_]*` optionally dotted (`ta.sma`), and exactly this punctuation table:

```
=>  :=  ==  !=  >=  <=  +=  -=  *=  /=  %=  ?  :  ,  (  )  [  ]  >  <  +  -  *  /  %  =  !
```

**`.` is not in that table.** A dot is only ever consumed as part of a dotted identifier (`while (text[j] === '.' && IDENT_START.test(text[j+1]))`, i.e. it must sit immediately after identifier characters) or as the decimal point of a number. Every other dot falls through to the final `throw new PineRefusal('pine:character', …)`.

### The class, exhaustively — three causes, and one of them makes all the noise

Over the 1443 surveyed scripts the lexer refuses **186 (12.9%)**.

**CAUSE 1 — `U+002E FULL STOP` that does not immediately follow an identifier character.** **183 scripts (12.7%), 2,501 sites.** What precedes it:

| the dot follows | sites | % of dot sites | scripts | a real example |
|---|---|---|---|---|
| ')'  — member access on a CALL RESULT | 1,885 | 75.4% | 171 | `if array.get(fibZones, i).active` |
| a SPACE — `box .new(...)` | 441 | 17.6% | 27 | `bin.bx.unshift(box .new(top = fvg.top, bottom = fvg.btm, left = fvg.loc     ` |
| a LETTER/other — a prose dot inside a broken multi-line string | 174 | 7.0% | 22 | `tooltip = "Determines the difference in lengths between the slow and fast mo` |
| other '%' | 1 | 0.0% | 1 | `\n\nDiscrepancies occur when the two values differ by more than the percenta` |

**The single dominant case — 75.4% of all refused dot sites, 171 scripts — is member access on a non-identifier expression**: `f().field`, `arr.get(i).price`, `obj.method().x`, `chart.point.from_index(...).price`. Standard Pine v5/v6 idiom; the lexer has no rule for it, because it only continues a dotted identifier while the dot sits immediately after identifier characters. Second (17.6%) is a **space before the dot** — `box .new(...)`, `id .binary_search_leftmost(...)`. Third (7.0%) is a prose dot reached only after cause 2.

**CAUSE 2 — a newline inside a string literal (a multi-line string).** **18 scripts (1.2%), 158 sites.** `lexPine` breaks a string at `\n` and throws. Published scripts write long `tooltip =` / `var string t1 =` blocks across several lines, and Pine accepts them.

**⭐ And cause 2 manufactures every exotic character in the histogram — this is measured, not inferred.** Once the lexer aborts a string at a newline it resumes lexing PROSE as code, and the character it then names is whatever sits on the continuation line:

| offender | scripts | of which ALSO have a broken multi-line string |
|---|---|---|
| `U+005C` REVERSE SOLIDUS (a `\n` escape in the prose) | 13 | **13 — all of them** |
| any non-ASCII character | 9 | **8** |

`cosine-kernel-regressions-quantrasystems` opens with `Created_by = "` on line 1 and does not close the quote until line 12 — the box-drawing banner and the `🟪` runs are *inside a string literal*. Same for the `U+2013 EN DASH` (336 sites), `U+2007 FIGURE SPACE`, `U+2003 EM SPACE`, `U+00A0 NO-BREAK SPACE`, `U+2022 BULLET` and the triangles: **all prose.** Fix the multi-line string and every one of them leaves the histogram.

**CAUSE 3 — a Unicode SPACE used as whitespace. Exactly 1 script in 1443.** `lexPine`'s whitespace class is literally `{' ', '\t', '\n'}`, so `U+00A0`, `U+2003`, `U+2007` and `U+3000` are not skipped. `footprint__6848998fe8` line 241 indents a COMMENT with `U+3000 IDEOGRAPHIC SPACE`, and the lexer hits it before it ever reaches the `//`.

### The residue that is genuinely not valid Pine

`;` (1 script), `{` `}` (1 script), `` ` `` (3 scripts, all cascade). **There is no Unicode-identifier problem, no smart-quote problem, and — apart from that one ideographic space — no whitespace problem in this corpus.** Causes 1 and 2 are the whole guard.

### The fix, precisely

1. Add `.` to `PUNCT` (after the longest-first entries, so `.` cannot shadow anything) and let the parser build a member-access node on any expression, not just on an identifier prefix. That is 75.4% of the sites.
2. Let a string literal span newlines (or at minimum refuse with a sentence that says "a string literal is not closed on this line" rather than "Pine has no character like this one" while pointing at a box-drawing glyph 11 lines away). That is cause 2 and, transitively, every exotic character in the table.
3. Widen the whitespace class to Unicode spaces. One script, but a one-line change.

### ⛔ And here is the thing worth knowing before anyone fixes it

On the survey, the lexer blocks **186 of 1443 scripts (12.9%)**. But `pine:character` is the SOLE blocker for **2 of them**. The lexer runs first and aborts the file, so it *reports* a 16% blocker while *hiding* the reason those scripts would have failed anyway:

| what the dot-blocked scripts hit next (from their own feature vectors) | scripts | share |
|---|---|---|
| pine:block (loops) | 158 | 86% |
| pine:type (UDT) | 132 | 72% |
| pine:collection | 113 | 62% |
| pine:request | 55 | 30% |
| pine:module | 31 | 17% |
| pine:state (varip) | 4 | 2% |
| pine:declaration-* | 2 | 1% |
| nothing else modelled | 3 | 2% |

**Fixing the lexer is still worth doing** — it is a two-line change (accept `.` as punctuation and let the parser build a member-access node; allow a newline inside a string), it turns a wrong-sounding refusal into a true one, and it is a prerequisite for ever reading a UDT script. It is not, on its own, a translation-rate lever.

## The top 5 changes, in order

Greedy: at each step, lift the guard that leaves the most scripts with NO remaining blocker. Two views, because they answer different questions.

### (a) On the engine's own reported guards (500 judged) — biased by pipeline order

| # | lift | newly unblocked | cumulative | % of 500 |
|---|---|---|---|---|
| 1 | `pine:no-output` | +51 | 220 | **44.0%** |
| 2 | `pine:character` | +47 | 267 | **53.4%** |
| 3 | `pine:declaration-strategy` | +20 | 287 | **57.4%** |
| 4 | `pine:request` | +17 | 304 | **60.8%** |
| 5 | `pine:function` | +18 | 322 | **64.4%** |
| 6 | `pine:state` | +16 | 338 | **67.6%** |

This view flatters the two guards that fire earliest (`pine:no-output` in the output scan, `pine:character` in the lexer) because the engine records only the first refusal each output reaches. Corrected for that — substituting the lexer-blocked scripts' real feature vectors — `pine:character` drops from step 2 to step 3 and from +47 to +20.

### ⭐ (b) On a per-script blocker model over all 1,443 — the roadmap answer

Calibration: the model predicts CLEAN for 84 of the 267 scripts in both sets; the engine actually says ok for 91. It misses a blocker on 28 and over-predicts on 35 (it is not reachability-aware). The errors nearly cancel: **calibration factor 1.083**. Both columns are given.

**Today: 349 of 1443 = 24.2% predicted clean (calibrated ≈26.2%), against the engine's measured 33.8% on 500 and 25.5% on the earlier 467.**

| # | lift | what that change actually is | newly unblocked | cumulative | % of 1,443 | calibrated |
|---|---|---|---|---|---|---|
| 1 | `pine:request` | a SECOND FEED plus a wider timeframe ladder — a literal foreign ticker, and the intraday/daily rungs `tf` cannot resample from daily bars | +80 | 429 | **29.7%** | ≈32.2% |
| 2 | `pine:function` | VOCABULARY — declare the ~45 missing `ta.`/`math.` names, starting with `math.floor`/`math.ceil` | +69 | 498 | **34.5%** | ≈37.4% |
| 3 | `pine:block` | a LOOP NODE — the expression tree becomes a statement runtime | +86 | 584 | **40.5%** | ≈43.8% |
| 4 | `pine:collection` | ARRAY/MATRIX/MAP nodes with a bounded pool | +126 | 710 | **49.2%** | ≈53.3% |
| 5 | `pine:no-output` | DRAWINGS AS OUTPUT — i.e. become a renderer, not just a column source | +138 | 848 | **58.8%** | ≈63.7% |
| 6 | `pine:type` | USER-DEFINED TYPES and methods | +105 | 953 | **66.0%** | ≈71.5% |
| 7 | `pine:character` | the LEXER — member access on a call result, and newlines inside strings | +91 | 1044 | **72.3%** | ≈78.4% |
| 8 | `pine:module` | LIBRARY IMPORTS — fetch and inline the imported script | +82 | 1126 | **78.0%** | ≈84.5% |

**The top 5, stated plainly:**

1. **pine:request** — a SECOND FEED plus a wider timeframe ladder — a literal foreign ticker, and the intraday/daily rungs `tf` cannot resample from daily bars. Translate rate 24.2% → **29.7%** (calibrated ≈32.2%).
2. **pine:function** — VOCABULARY — declare the ~45 missing `ta.`/`math.` names, starting with `math.floor`/`math.ceil`. Translate rate 29.7% → **34.5%** (calibrated ≈37.4%).
3. **pine:block** — a LOOP NODE — the expression tree becomes a statement runtime. Translate rate 34.5% → **40.5%** (calibrated ≈43.8%).
4. **pine:collection** — ARRAY/MATRIX/MAP nodes with a bounded pool. Translate rate 40.5% → **49.2%** (calibrated ≈53.3%).
5. **pine:no-output** — DRAWINGS AS OUTPUT — i.e. become a renderer, not just a column source. Translate rate 49.2% → **58.8%** (calibrated ≈63.7%).

Sole-blocker counts, which is what makes step 1 step 1:

| guard | scripts it is the ONLY blocker for | % of 1,443 |
|---|---|---|
| `pine:request` | 80 | 5.5% |
| `pine:function` | 60 | 4.2% |
| `pine:block` | 57 | 4.0% |
| `pine:no-output` | 29 | 2.0% |
| `pine:collection` | 14 | 1.0% |
| `pine:module` | 8 | 0.6% |
| `pine:type` | 8 | 0.6% |
| `pine:builtin` | 4 | 0.3% |
| `pine:state` | 3 | 0.2% |
| `pine:character` | 2 | 0.1% |

## Where this refusal map differs from what a RENDERER would need

The refusal histogram is calibrated for the **screener door**: "ok" means at least one screenable column was offered. Read as a renderer roadmap it is wrong in five specific places.

| # | the screener says | a renderer needs |
|---|---|---|
| 1 | `pine:no-output` blocks 345 of 1443 scripts (23.9%) | **not a blocker at all.** 330 of those (22.9% of the corpus) draw lines, labels, boxes and tables for a living — that IS the product. This is the single biggest divergence in the whole map. |
| 2 | `pine:drawing` fires on **0 of 500** because a bare `line.new(...)` statement is noted and ignored | the entire drawing object model is the work: `line.new` (594 scripts), `label.new` (599), `box.new` (362), `table.new` (254), `linefill.new` (90), `polyline.new` (55), plus 292 scripts calling setters and 414 calling `.delete` |
| 3 | 28 features are `ignored` — 22,279 call sites cost nothing | every one is mandatory: `color.new` (59.3% of scripts), `str.tostring` (33.5%), `color.rgb` (18.6%), `color.from_gradient` (11.5%), `input.color` (45.8%) |
| 4 | `pine:state` is a **deliberate, explicitly non-backlog** ruling — an unbounded accumulator would end static decidability | **free.** A bar-by-bar renderer holds unbounded state by construction; there is no `maxLookback` tree-sum to preserve. `varip` stays hard (intrabar), but plain unbounded `var` stops being a limit |
| 5 | `for`/`while` are `pine:block`, no node | **free.** A statement runtime runs them. The 47.1% of the corpus that loops is a *performance* problem for a renderer, not a grammar one |

Net: of the guards above, **`pine:no-output`, `pine:drawing`, `pine:text-value`, `pine:colour-value`, `pine:state` and `pine:block` invert sign** when the door changes from "offer a column" to "draw the script". `pine:request`, `pine:module`, `pine:tuple`, `pine:function`, `pine:builtin`, `pine:type` and `pine:collection` stay real work either way.

---

# TASK C — the anti-patterns we will have to run

Everything here is a **runtime** cost, not a translation cost. A screener that stores an expression tree never pays any of it; a renderer that must execute bar-by-bar pays all of it.

## 1. Declaration limits — the pools a script asks for before it computes anything

| limit | scripts | % of 1,443 | value distribution |
|---|---|---|---|
| `max_bars_back` | 327 | 22.7% | `5000`×155, `500`×60, `1000`×40, `2000`×18, `3000`×10, `4000`×8 |
| `max_lines_count` | 476 | 33.0% | `500`×416, `100`×13, `maxBoxesCount`×9, `50`×8, `150`×7, `300`×5 |
| `max_labels_count` | 437 | 30.3% | `500`×380, `100`×12, `maxBoxesCount`×9, `50`×8, `200`×8, `300`×5 |
| `max_boxes_count` | 323 | 22.4% | `500`×275, `200`×9, `maxBoxesCount`×9, `100`×7, `50`×6, `250`×5 |
| `max_polylines_count` | 44 | 3.0% | `100`×42, `40`×1, `50`×1 |
| `calc_bars_count` | 24 | 1.7% | `5000`×6, `10000`×4, `500`×2, `20000`×2, `1000`×2, `2000`×2 |

**`max_bars_back` is set by 327 scripts (22.7%), and the modal value is `5000` (155 scripts) — TradingView's own ceiling.** What it means for us: the author is declaring that some series in the script is indexed further back than Pine's automatic inference could work out, usually because the offset is computed rather than literal.

**Cost.** `max_bars_back` is a *buffer allocation* directive. A bar-by-bar runtime must keep a ring buffer of that depth **for every series that can be indexed**, not just for the one that needs it — Pine applies it per-variable but authors set it globally. 5,000 bars × the number of live series × 8 bytes is the floor; a script with 40 intermediate series is 1.6 MB of history per symbol per instance, before a single drawing exists. And it cannot be lazily grown: the whole point of the declaration is that the depth is not statically inferable, so the buffer has to be right on bar 1 or the script re-runs.

**The drawing pools are bigger than the bar pools.** `max_lines_count` is set by 476 scripts (33.0%) and 416 of them ask for the **500 maximum**; `max_labels_count` by 437 (30.3%), 380 at 500; `max_boxes_count` by 323 (22.4%), 275 at 500. A third of the corpus asks for 500 live line objects. **Cost:** 500 lines + 500 labels + 500 boxes is 1,500 addressable, mutable, individually deletable scene objects per instance, each with its own coordinates, style and z-order — and `_setters` (292 scripts) means they are mutated after creation, so the scene graph cannot be immutable. This is the real shape of the runtime: not arithmetic, object lifetime.

`calc_bars_count` appears in only 24 scripts but is the opposite lever — the author capping how far back to compute at all (`10000`, `20000`), i.e. admitting the script is too slow.

## 2. Deep history references — `max_history_ref` distribution

1033 of 1443 scripts (71.6%) contain at least one literal `[n]`. **median 1, mean 6.1, p90 3, p99 25, max 2900.**

| deepest literal offset | scripts | % of 1,443 |
|---|---|---|
| `[1]` | 767 | 53.2% |
| `[2..5]` | 238 | 16.5% |
| `[6..20]` | 16 | 1.1% |
| `[21..50]` | 5 | 0.3% |
| `[51..100]` | 2 | 0.1% |
| `[101..500]` | 3 | 0.2% |
| `[501+]` | 2 | 0.1% |

**The distribution is a cliff, and that is the good news.** 767 scripts (53.2%) never index deeper than `[1]`; 1,005 of the 1,033 (97.3%) stay within `[5]`. Only **12 scripts in the whole corpus** index deeper than `[20]`, and the tail is `2900`, `1000`, `250`, `180`, `101`.

**Cost.** A ring buffer sized by the *static maximum* is the wrong design here: sizing every series to the corpus maximum (2,900) to serve a corpus whose 97th percentile is 5 wastes three orders of magnitude. Size per-series from the tree's own `maxLookback` — which our screener already computes as a static tree sum — and treat the dozen deep scripts as the exception that allocates. The `2900` case (`supply-demand-cumulative-volume-delta-flow-chartprime`) and the `1000` case (`volumetric-regression-heatmap-luxalgo`) are exactly the two that also set `max_bars_back`, which is the author telling you so.

## 3. Heavy loops

| measure | value | % of 1,443 |
|---|---|---|
| scripts with any loop | 679 | 47.1% |
| `for` call sites | 4,476 | — |
| `while` call sites | 334 | — |
| scripts with NESTED loops (depth ≥ 2) | 231 | 16.0% |
| scripts with depth ≥ 3 | 35 | 2.4% |

Loop-heaviest scripts: `realtime-tpo-profile-kioseff-trading` (107 `for`), `volume-delta-oi-delta-kioseff-trading` (66), `ichimoku-kinko-hyo-一目均衡表` (61 `for` + 10 `while`), `volume-footprint-measuring-classical-indicators` (61 + 6), `volume-dots` (60), `quadapt-machine-learning-trader` (56 + 2), `ict-validated-smc-v18` (42 + 13).

## 4. Loops over arrays of drawings — the compound case

| pool | scripts | % of 1,443 | sites |
|---|---|---|---|
| `array_new_generic` | 610 | 42.3% | 4,868 |
| `deletes` | 414 | 28.7% | 3,632 |
| `array_of_drawings` | 240 | 16.6% | 1,410 |
| `matrix_new` | 47 | 3.3% | 144 |
| `all_arrays` | 46 | 3.2% | 131 |
| `map_new` | 23 | 1.6% | 36 |

**240 scripts (16.6%) hold an ARRAY OF DRAWING OBJECTS** — `array.new_line`, `array.new_box`, `array.new_label` — across 1,410 sites, and 414 scripts (28.7%) call `.delete` 3,632 times.

**Cost, and this is the worst item on the page.** The idiom is: every bar, walk an array of live line/box objects, test each against the current bar, mutate or delete some, push new ones. That is `O(pool × bars)` object touches with allocation and free on the hot path — 500 objects × 5,000 bars = 2.5 M scene-graph mutations for ONE symbol on ONE instance. And because the loop reads and writes drawing state, it is **not** hoistable, memoisable or skippable on unchanged bars: the pool at bar *i* depends on the pool at bar *i−1*. It also composes with §3 — the 150 scripts (10.4%) that carry loops AND collections AND user-defined types together are the same ICT/SMC/zigzag cohort, and they are the hardest thing in the corpus to run at all.

## 5. `varip`

17 scripts (1.2%), 120 declarations. Concentrated, not spread: `footprint` (31), `rs-footprint` (15), `volume-delta-candles-luxalgo` (13), `volume-analysis-heatmap-and-volume-profile` (12), `delta-volume-realtime-action-lucf` (10) — order-flow and footprint scripts, every one.

**Cost.** `varip` persists across **intrabar ticks**, so its value is a function of how many times a forming bar updated. Two consequences: (a) a runtime that replays closed bars can never reproduce it — the number is not determined by the bar data, so there is no correct answer to compute, only a convention to pick; (b) a runtime that DOES tick has to keep two update paths (per-tick and per-bar-close) and roll back the per-tick one when a bar is revised. At 1.2% of the corpus and confined to one genre, this is the clearest **do-not-build** on the page: refuse it by name, as the screener already does, and say why.

## 6. `strategy.*` in an indicator — **the anti-pattern is not there**

Declaration mix: `indicator` 925, `study` 440, `strategy` 78. 0 scripts call `strategy.*` while declared `indicator`/`study` — **zero**. All 78 scripts that place orders declare `strategy(...)`, and all 78 strategy-declaring scripts place orders. The hypothesis was worth testing and it is clean: there is no mislabelled-strategy population to plan for. The 78 are a self-identifying set you either run as backtests or refuse as a set.

## 7. Library imports

123 scripts (8.5%), 246 `import` statements, **124 distinct libraries** (name/version pairs). Heaviest importers pull 6–7 libraries each. Most-imported:

| library | importing scripts |
|---|---|
| `TFlab/AlertSenderLibrary_TradingFinder/1` | 19 |
| `TFlab/OrderBlockRefiner_TradingFinder/2` | 12 |
| `TradingView/ta/7` | 11 |
| `TradingView/ta/12` | 11 |
| `TFlab/OrderBlockDrawing_TradingFinder/4` | 9 |
| `TFlab/FVGDetectorLibrary/3` | 8 |
| `TFlab/Dark_Light_Theme_TradingFinder_Switching_Colors_Library/1` | 4 |
| `TradingView/ta/9` | 4 |

**Cost.** Three distinct problems wearing one guard. (a) **Acquisition**: the library body is a separate publication that has to be fetched, and it may import further libraries — this is a transitive closure, not a lookup. (b) **Versioning**: `TradingView/ta/7`, `/9` and `/12` are all live in this corpus simultaneously, so "the library" is not a thing — a version-pinned copy is. (c) **Runtime**: an imported function is an ordinary Pine function, so once fetched it inlines the same way a local UDF does and costs nothing new. That ordering matters for the roadmap: `pine:module` is mostly a **fetcher** ticket, not a runtime ticket, and it is the single cheapest of the structural guards for that reason.

---

## Provenance of every number on this page

| number | from |
|---|---|
| feature demand (% scripts, call sites) | `acq/agg_computation.json`, `acq/inventory.json` (n=1,443) |
| our supported vocabulary | `origin/master:app/src/components/chart/engine/ast/closedTable.json` — 64 `functions`, 137 `scalars`, 5 `series`, 13 `clock`, 15 `operators` |
| our refusal semantics | `origin/master:app/src/components/chart/engine/ast/pine.js` — `REFUSALS`, `NAMESPACE_GUARD`, `PINE_CALL_SHAPES`, `PINE_NAMESPACED_TREE`, `BUILTIN_CALL_TREE`, `PINE_INEXPRESSIBLE`, `lexPine`, `pickOutputArgument`, `inlineUserFunction` |
| engine verdicts (run-1, complete) | `acq/engine_refusal_agg.json` as delivered — 467 judged, 119 ok |
| engine verdicts (run-2, frozen) | `research/_lane2/engine_status.snapshot.json` — 500 judged, 169 ok |
| Pine v6 denominator | `scratchpad/v6ref.json` |
| character class | `research/_lane2/charclass.py` + `charclass.json` + `dotclass.json` — an independent replica of `lexPine`, exact agreement 47/47 |
| blocker model + projections | `research/_lane2/project.py` + `project.json`, `sole.json` |

Working files, all under `research/_lane2/`: `charclass.py`/`.json`, `dotclass.py`/`.json`, `crossref.py`, `taskA.json`, `blockers.py`/`.json`, `denom.py`/`.json`, `project.py`/`.json`, `sole.json`, `nooutput.json`, `engine_status.snapshot.json`.
