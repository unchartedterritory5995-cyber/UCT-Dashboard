# Item (e) — the SHORT-CIRCUIT census

**Instrument:** `tools/pine_short_circuit_census.py` — read-only, `python tools/pine_short_circuit_census.py`
**Corpus:** `corpus/committed/*.pine` (266) + `tests/fixtures/member/*.pine` (3) = **269 scripts**
**Run:** 2026-09-15. Controls **OK**, exit **0**.

Pine's `and`, `or` and `?:` short-circuit — the right operand is not evaluated when the
left decides. This engine *plans* expressions rather than evaluating them. The question
this census answers is **where that difference is observable**, and the headline is that
it is observable in far fewer places than the shape of the question suggests, for a
reason nobody had written down: **the resolver already short-circuits at plan time, but
only when the deciding operand resolves to a literal `num` node — and a numeric
comparison of two plan-time constants does not.**

---

## e.1 — WHAT THE ENGINE DOES TODAY (read, not inferred)

Every line below is re-read at its stated line number by the instrument's **CONTROL 2**
on every run, so a drifted citation fails the tool instead of ageing quietly.

### How are `and` / `or` / `?:` represented?

| fact | where |
|---|---|
| All three are the **`op`** node type — operator on `name`, operands in `args`. There is **no ternary node type**; `NODE_TYPES` is frozen at eleven. | `app/src/components/chart/engine/ast/parse.js:378` |
| `closedTable.json::operators` declares `&&` arity 2 `yields: bool`, `\|\|` arity 2 `yields: bool`, `?:` arity 3 `yields: passthrough`. 15 operators total. | `closedTable.json::operators` |
| Pine v2/v3's `iff(cond, a, b)` rewrites to **the same** `cOp('?:', …)` node — so it is the same use-shape, not a call. | `pine.js:1451` |
| The resolver builds `cOp('?:', [test, yes, no])`. | `pine.js:5915` |

### Is there existing short-circuit awareness? **Yes — at plan time, and narrower than it looks.**

| fact | where |
|---|---|
| `logicalAnnihilator(op)` — the value that decides an operator on its own: `0` for `&&`, `1` for `\|\|`. **One owner, two callers**, by design. | `pine.js:4197` |
| **"AN OPERAND THE OTHER SIDE HAS ALREADY DECIDED IS NOT RESOLVED AT ALL."** The resolver resolves the **left** first; if it is a `num` equal to the annihilator it returns that constant and **never resolves the right**. | `pine.js:5873`, `pine.js:5897–5901` |
| The ternary does the same: `if (test.type === 'num') return this.resolve(test.value !== 0 ? node.yes : node.no)` — a branch a constant test never takes is not resolved. | `pine.js:5914` |
| `foldLogicalIdentity` additionally folds `X && 1 → X`, `1 && X → X`, `X \|\| 0 → X` (guarded by `treeYieldsBool`). | `pine.js:4201` |
| ⛔ **A KNOWN, DECLARED ASYMMETRY:** if the LEFT refuses and the RIGHT is the deciding constant, the script still refuses. Left-to-right refusal reporting was judged worth more. | `pine.js:5891–5896` |

⛔⛔ **THE GATE IS `type === 'num'`, AND THAT IS NARROWER THAN "PLAN-TIME DECIDABLE".**
Three things produce a `num` in a deciding position: a numeric/boolean **literal**; an
`input.{bool,int,float}` (or the bare v3/v4 `input(...)`) **folded to its default**; and a
`==`/`!=` between two **plan-time strings** (`pine.js:5816`, via `stringValueOf`,
`pine.js:5281` — which reads `defval` and never asks the input's kind).

A **numeric comparison does not fold.** `FOLD_BINARY` (`pine.js:3690`) is `+ - * /` and
its own comment says so — *"DELIBERATELY NOT THE COMPARISONS OR THE LOGICALS"* — with a
window slot as its only caller. So `len > 5 ? heavy : light` has a test every reader would
call constant and **both arms are still resolved**. So does `dynamic_pivot_levels == false`.
And `syminfo.ticker == "SPY"` deliberately defers into a `textop` (`pine.js:5825`), not a
`num`, because no symbol has been chosen yet.

### At run time: nothing short-circuits, and the source says so

| fact | where |
|---|---|
| `logical = (f) => (a, b) => (isNan(a) \|\| isNan(b) ? NaN : (f(a !== 0, b !== 0) ? 1 : 0))` — NaN propagates from **either** operand. No selection. | `interpret.js:2157` |
| `TERNARY = (t, a, b) => (isNan(t) ? NaN : (t !== 0 ? a : b))` — **selects**. The untaken arm is computed and **discarded**. | `interpret.js:2191` |
| The IR lane states the position outright: *"ARGUMENTS ARE ALREADY EVALUATED, which is correct HERE and will NOT be correct once a branch can have an effect… that is JUMP_IF_FALSE's job."* | `runtime/vm.js:306` |

### Does lookback accounting walk both operands unconditionally? **Yes — both lanes.**

| fact | where |
|---|---|
| `maxLookback`'s `op` arm: `let best = 0; for (const arg of node.args) best = Math.max(best, seen.get(arg))`. No operand is privileged. | `interpret.js:2582` |
| The repaint linter's `op` arm: *"An operator is POINTWISE"* — `maxReach` over every child, back **and** forward. | `lint.js:634` |

⭐ **AND THAT IS CORRECT, WHICH IS THE LOAD-BEARING FINDING FOR (A).** `maxLookback` is a
**static upper bound over every bar**. When the left is a *series*, short-circuiting is a
*per-bar* fact: on some bar the left does not decide, the right runs, and its history is
genuinely needed. When the left *does* fold, the resolver has already deleted the right
before `maxLookback` ever sees the tree. There is no third case except the fold gap above.

---

## e.3 — THE TABLE

### e.3a — one row per FORM

| form | uses | files | conditional operands | **admissible + reachable** | left plan-time decidable | folds to `num` | **PRUNED today** | may prune¹ | **decidable but NOT folded** | binding constraint | named corpus script |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `and` | **6 032** | 226 | 6 032 | **1 871** | 1 268 | 1 123 | 159 | 300 | **157** | `pine.js:5897` (annihilator `0`) | `atr-god-strategy-by-tradesmart__4369755a29.pine:32` |
| `or` | **826** | 128 | 826 | **278** | 84 | 62 | 7 | 50 | **25** | `pine.js:5897` (annihilator `1`) | `swing-points-and-liquidity-by-leviathan__919c1fd9c6.pine:83` |
| `?:` | **7 030** | 246 | 14 060 | **6 084** | 1 919 | 1 668 | 1 668 | 0 | **291** | `pine.js:5914` (`test.type === 'num'`) | `camarilla__jw9faob08r.pine:84` |
| `iff` | **18** | 7 | 36 | **26** | 2 | 2 | 2 | 0 | **0** | `pine.js:1451` (rewrites to `?:`) | `fibonacci-retracement-mtflog__54a8dbfa8e.pine:69` |

¹ *may prune* = the left folds to a constant whose **value** the census cannot read (a
string comparison, both literals blanked by the stripper). It prunes on one of the two
outcomes; a ternary prunes either way, which is why that column is 0 for `?:`.

A `?:` contributes **two** conditional operands (both arms); `and`/`or` contribute one.
Totals: **13 906 uses**, **20 954 conditional operands**, in **262 of 269** scripts.
Separately: **6 117 `if` statements**, which `foldIfChain` folds into nested `?:` and which
inherit the same question.

### e.3b — right-operand shape × left kind (top rows; the tool prints all 38)

| form | right-operand shape | left is plan-time decidable | n | reserves bars | reaches an output |
|---|---|---|---|---|---|
| `?:` | series | no (series) | 6 036 | 304 | 2 188 |
| `and` | series | no (series) | 4 019 | 476 | 1 283 |
| `?:` | series | yes (input default) | 2 004 | 72 | 925 |
| `?:` | **`na`** | no (series) | 1 328 | 28 | 1 009 |
| `?:` | call | no (series) | 1 202 | 230 | 485 |
| `and` | series | yes (input default) | 1 109 | 8 | 372 |
| `?:` | constant | no (series) | 964 | 0 | 456 |
| `and` | call | no (series) | 745 | 122 | 193 |
| `?:` | **`na`** | yes (input default) | 663 | 10 | 543 |
| `?:` | text-literal | no (series) | 629 | 0 | 50 |
| `?:` | call | yes (input default) | 430 | 145 | 228 |
| `?:` | **`request.security`** | yes (input default) | **109** | 13 | **48** |
| `?:` | `request.*` | yes (input default) | 1 | 0 | 0 |
| `?:` | **`request.security`** | **no (series)** | **1** | 0 | 0 |
| `and` | **`na`** | — | **0** | — | — |
| `or` | **`na`** | — | **0** | — | — |

---

## e.2 — THE THREE CASES

### (A) LOOKBACK / REPAINT

| | n |
|---|---|
| conditional operands that **reserve bars** (history ref or a manifest `lookback ≠ 0` call) | 1 478 |
| … and reach an output | **844** |
| … whose left is a **series** — *correct to reserve, and reserving is the only sound answer* | 676 |
| … whose left is plan-time decidable | 168 |
| …… **already pruned** by the resolver today | 156 |
| …… **decidable but NOT folded — the gap** | **11** |

**Exercised: yes. Engine wrong: no — 0 of 844 over-reserve for a reason the engine could
fix by evaluating differently.** The 676 series-left rows are correct by construction (a
static bound must cover the bar on which the left does not decide). The 156 decidable-left
rows are already deleted before `maxLookback` runs. The residue is **11 operands in 3
scripts**, and every one is the *fold gap*, not an evaluation gap:

- `cppivot-boss-floor-pivots-with-atr-dilation-and-dynamic-levels__eb13ccd13f.pine:147–155` (9 rows) —
  `dynamic_pivot_levels == false ? 1 : show_daily_pivot[1] == true and … ? 1 : 0`. The test is an
  `input.bool` compared to `false`; `FOLD_BINARY` does not cover `==`, so the arm carrying `[1]` is
  resolved and one bar is reserved.
- `fibonacci-retracement-mtflog__54a8dbfa8e.pine:69` — `rf == 0 ? time : ta.valuewhen(anchored, time, rf - 1)`.
- `swing-points-and-liquidity-by-leviathan__919c1fd9c6.pine:83` — `oitresh > 0 ? math.abs(deltaOI[swingSizeR]) > oitresh : true`.

### (B) `na` POISONING

| | n |
|---|---|
| bare `na` as an `and`/`or` operand — where `logical` (`interpret.js:2157`) **propagates** | **0** |
| bare `na` as a **ternary arm** — where `TERNARY` (`interpret.js:2191`) **selects** | 2 013 |
| … reaching an output | 1 570 |

**Exercised: not in the form that can go wrong. Engine wrong: no.** The 2 013 `na` arms are
the `plot(cond ? value : na)` idiom, and the ternary **selects** — the untaken arm is
computed and discarded, never blended, so the engine already answers what Pine answers.
The shape that *could* diverge — `na` on the right of `and`/`or`, where NaN propagates from
either side regardless of what the left says — occurs **zero times in 269 scripts**.

⚠️ Two facts worth recording even at zero, because they bound how long that zero is safe:
- The engine's NaN-propagating `and` **matches Pine v5**; `pine.js:6568` records TradingView's
  own v5 `and` propagating `na` rather than collapsing it to false.
- **Pine v6 changed the rule**: `docs/pine/builtins-and-adoption.md:245` quotes the v6 release
  notes — *"`bool` is strictly true/false (never `na`), short-circuit `and`/`or`"*. The corpus is
  **v4 71 · v5 125 · v6 73**, so 27 % of it is already on the version where this diverges by
  specification rather than by accident.

### (C) AN UNISSUED REQUEST

| | n |
|---|---|
| conditional operands carrying a `request.*` | **111** |
| … reaching an output | 48 |
| … whose gate is **already pruned** by the resolver today | **110** |
| … whose gate is decidable but **not folded** — would be issued | **0** |
| … whose gate is a **series** — per-bar, unprunable at plan time | **1** |

**Exercised: yes, 111 times. Engine wrong: no — and it is not even reachable today.**
Every one of the 111 is refused at **`pine:request`** (one of the 41 refusals), so nothing is
issued because nothing translates. Of the 111, **110 are gated by a test that already folds**:

- `camarilla__jw9faob08r.pine:84` — `islast = showlast ? security(…) : true`, `showlast` an `input.bool`.
- `screener-mean-reversion-channel__nTK2sHWDlB.pine:204–…` — `asset_01 == '' ? 0 : security(asset_01, …)`, ×20,
  gated by the **v3 spelling** `input(title=…, type=input.symbol, defval='')`; `stringValueOf` reads
  `defval` and folds the comparison.
- `black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2.pine:360`, `:426` — `input.bool` gate.
- `ict-ipda-look-back__f85b4c8956.pine:87` — `_showLTF ? time[20] : request.security(…)`.

The single unprunable one is `liquidity-heatmap-nephew-sam__7628c72c3d.pine:132` —
`float result = tf == "" ? chartTf : request.security(syminfo.tickerid, tf, chartTf)` inside a user
function, where `tf` is a **parameter**, not an input. It does not reach an output.

---

## e.4 — VERDICT against the ~20 threshold

| case | admissible-and-reachable count | vs ~20 | verdict |
|---|---|---|---|
| **(A) lookback / repaint** | **11** (the fold gap) — 0 where evaluation order is the cause | **UNDER** | **RETIRE — record the ruling, change nothing in evaluation.** `maxLookback`'s unconditional `Math.max` (`interpret.js:2582`) is *correct* for a series left and *moot* for a folded left. The 11 that remain are not a short-circuit defect at all; they are `FOLD_BINARY` (`pine.js:3690`) not covering `==`. **Route them to the FOLD, by name** — widening `FOLD_BINARY` to comparisons is a separate change with its own ruling (its own comment says so: *"Widening this set is a decision about what a fold MEANS"*), and until someone makes it, these 11 operands in 3 named scripts reserve bars nothing reads. Nothing that works is removed. |
| **(B) `na` poisoning** | **0** — and the detector fires on a fixture that has it (CAN-FIRE control B) | **UNDER** | **RETIRE — but write the semantics table, not a nil return.** The absence is real and proven fireable. The reason to record it rather than close it: the engine's propagating `and` is *v5-correct* and *v6-incorrect by specification*, and 73 of 269 scripts are already v6. Note `interpret.js:2157` **by name** with the v6 quote beside it, so the next reader meets the divergence as a recorded ruling rather than rediscovering it from a member's wrong column. |
| **(C) an unissued request** | **1** (unprunable gate) of 111, and **0** reach an output | **UNDER** | **ROUTE TO ITEM (c) BY NAME — do not build here.** The expensive failure does not exist today: every one of the 111 is refused at `pine:request`, and 110 would be pruned by the *existing* ternary fold the moment (c) lands. The one genuinely unprunable gate (`liquidity-heatmap-nephew-sam…:132`) is a **UDF parameter**, so item (c)'s inlining decides it, not item (e). Record the number in (c)'s ledger: **if (c) ships, 110 of 111 corpus request-gates are already short-circuited, 1 is not, and 0 reach an output.** |

**Headline: 20 954 conditional operands across 13 906 `and`/`or`/`?:`/`iff` uses in 262 of 269
scripts — and the engine is measurably wrong in 0 of them. The one real gap is 11 operands
wide, and it is not in evaluation; it is that `FOLD_BINARY` stops at `+ - * /`.**

⚰️ **This refines a committed claim rather than confirming it.** `docs/pine/SESSION-STATE.md:723`
reads *"Both sides always evaluate today. No script in the 266-script corpus depends on it."*
The second sentence holds. The first is **wrong at plan time**: `pine.js:5873/5897/5914` short-circuit
`and`, `or` and `?:` whenever the deciding operand folds to a `num` — **1 836 of 13 906 uses**
(159 `and` + 7 `or` + 1 668 `?:` + 2 `iff`) have a conditional operand deleted before it is ever
resolved. It is right at run time (`interpret.js` lifts both, `vm.js:306` says so).

---

## CONTROL output, verbatim

```
--- CONTROL 1: the (b) census cross-check ---
  CONTROL b-census-timeframe-into-security expected 97 got 97 OK

--- CONTROL 2: every engine citation, re-read at its line ---
  CONTROL engine-citations expected 12 got 12 OK

--- CONTROL 3: the reachability cone vs (b)'s own consumers_of ---
  names checked 120   agree 81   cone-only (UDF return edge) 4   outside the cone 35
  CONTROL cone-has-no-false-negatives expected 0 got 0 OK
  CONTROL cone-is-not-everything expected >0 got 35 OK

VERDICT: controls OK
```

**CONTROL 1** re-derives the (b) census's committed **97** (`input.timeframe` uses consumed by
`request.security`) by calling **(b)'s own module** — its enumeration, its stripper, its
interprocedural `consumers_of`. **CONTROL 2** re-reads all 12 engine citations in this document
at their stated line numbers. **CONTROL 3** proves this census's batched reachability cone has no
false negatives against (b)'s per-name walk, *and* is not everything (35 of 120 sampled names are
outside it). Any of the five failing exits non-zero.

Import-time controls that must also pass before anything runs: the stripper both ways (a use in a
comment and in a string is invisible, a real one is not); precedence (`or` binds looser than
`and`); descent (an operator inside `plot(...)` is found); the line-structure control both ways;
the join control both ways; the `switch`-arm control; the reassignment control both ways; the
input-class control; the fold controls including *a numeric comparison must NOT fold*; and three
**end-to-end CAN-FIRE fixtures** — one per case — pushed through the whole per-file pipeline, plus
a null fixture that must produce neither a `na` row nor a request row.

---

## Defects found in this instrument while building it

Five, all found by **reading the table the tool printed**, none by review. Every one is now
railed with a control that reproduces the defect on demand, so none can come back silently.

| # | defect | how it read | measured effect |
|---|---|---|---|
| 1 | **A line ending in a string literal was read as a continuation.** `strip_pine` blanks the string, `rstrip()` exposes the `==` underneath, `CONT_END` sees a trailing `=`. Real line: `volume-suite-by-leviathan__48da793360.pine:382`. | a joined statement, so the next line's `plotcandle(` landed **inside** the `and`'s right operand **and** flipped that statement's *reaches an output* to true | fixed by running the join test on a **comments-only** strip (strings intact) while brackets are still counted on the fully stripped text. Joins fell 10 974 → 7 040. Fails in the flattering direction, so it is railed both ways. |
| 2 | **`=>` in `CONT_START` merged every `switch` arm with the next one.** Real lines: `3-level-zigzag-semafor__3078.pine:23–25`. | the arm `… != 1 => low` swallowed `=> na`, producing a bare `na` operand that **does not exist** | removed `=>` from the continuation set and added `split_arrows`, which splits a statement at top-level `=>`. Railed on the real corpus shape. |
| 3 | **A name's first assignment was read as its value.** `int direction = na` then `direction := 1` (`ai-supertrend…__3b9db05a48.pine:103`); `trend_st_1 = 1` then two `:=` (`atr-god-strategy-by-tradesmart__4369755a29.pine:29`). | `direction == -1 and direction[1] == 1` filed as a short-circuit opportunity with a **plan-time-decidable left** — it is an ordinary per-bar supertrend flip | any `:=`/compound-reassigned name is excluded from the decidable set and from fold chasing. The (A) gap fell **66 → 11**. Railed both ways (the same name must still fold when *not* reassigned). |
| 4 | **The input's KIND was asked instead of the default's SHAPE.** `screener-mean-reversion-channel__nTK2sHWDlB.pine:37` writes the v3 form `input(title=…, type=input.symbol, defval='')`, whose call name is the bare `input`. | 20 `request.security` gates read as **unprunable**; `pine.js:5281`'s `stringValueOf` never looks at the kind — it takes `defval` from `input` *or* `input.*` | classify by the default's shape first (exactly (b)'s own conclusion for time inputs). **(C)'s "would be issued" fell 78 → 0.** |
| 5 | **(b)'s `strip_pine` blanks the newline inside an unterminated quote, so the file loses lines.** Measured: **4 of 269 files**, up to **26 lines** in `delta-volume-candles-lucf__qADnaAfCPp.pine`. | this census reads the stripped text and the comment-stripped text as **two parallel line arrays**; they desynchronised, so after the first offending quote every continuation decision was taken against the **wrong** raw line and every reported line number was off. It manufactured the *only* case-(B) hit v3 reported — `higher-time-frame-fair-value-gap-zeroherotrading__202f1347b8.pine:382` shown as `:374`, a phantom join of `if barstate.isconfirmed and i_alert_price` with the line below | `strip_pine_lines` puts the newlines back one-for-one against `raw` (the stripper is substitution-only, so the correction is index-for-index safe) and the alignment is **asserted per file**. **(B) fell 1 → 0.** ⚠️ It is harmless to (b)'s own census, which only ever counts `\n` before an offset — but it is a property of a **shared** stripper and is recorded here for (b)'s and (c)'s owners. |

### Two corrections that were classification, not code

- **`empty` vs `text-literal`.** 687 conditional operands read `empty` — which says *the instrument
  failed to parse an arm*. They were **string-valued** arms (`isRanging ? "Ranging" : "Trending"`);
  the stripper blanks the literal, leaving whitespace of non-zero length. A zero-length arm is the
  genuine parse artefact and keeps the name. Residual `empty`: **94 of 20 954 (0.45 %)**, all nested
  ternaries inside multi-line `array.push(...)` calls in `auto-trendlines-tradingfinder…` — **a known,
  stated residual, not a repaired one.**
- **(B) was one number and is two.** v1 reported **2 030** `na` operands as one poisoning set. `TERNARY`
  (`interpret.js:2191`) *selects* and `logical` (`interpret.js:2157`) *propagates* — only the second is
  case (B). Splitting them moved the case-(B) headline **2 030 → 1**, and defect 5 then moved it **1 → 0**.

### What was checked and found clean

- The stripper is **(b)'s**, not a copy, so "what is a comment / a string" has one owner.
- Needles are built by concatenation (`_AND`, `_OR`, `_NA`, `_SEC`, `_REQ`).
- Manifest reads are **derived, never typed**: the lookback-bearing function set comes from
  `closedTable.json::functions[*].lookback`, and the namespace guard `(?<![\w.])(?:ta\.)?` keeps
  `math.log`, `array.max` and `str.length` out of it (instrument standard 7).
- Reachability is **interprocedural in both directions** — parameters forward (via (b)'s walk) and
  user-function returns backward — and the cone is proved a superset of (b)'s committed answer and
  proved not to be everything.
- Precedence is asked `?:` → `or` → `and`, with a control; associativity is right for `?:` and left
  for `or`/`and`.
- `iff` is counted as a `?:` (it rewrites to the same node at `pine.js:1451`), not as a call.
