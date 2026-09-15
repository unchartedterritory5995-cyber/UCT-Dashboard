# item (g) — `s := close` SERIES TYPING: the census

Instrument: `tools/pine_series_typing_census.py` (read-only, `python tools/pine_series_typing_census.py`).
Corpus: `corpus/committed/*.pine` (266) + `tests/fixtures/member/*.pine` (3) = **269 files**.
Measured 2026-09-15. Every number below is reproduced by running the tool; nothing here
is retyped from a run that is not in the tool's output.

---

## THE ANSWER FIRST (g.4)

**(g) is NOT a typing gap, and it is NOT mostly a refusal.** For the overwhelming
majority of the corpus it **already works**. Where it does refuse, it refuses for a
REAL reason and says the **wrong sentence** — the `accumulatorNote` shape exactly.

- **1,519 of 1,649** series-valued `:=` uses sit in a position the engine folds today
  (225 top-level · 1,208 inside `if`/`else` · 86 inside a function body). Only **130**
  sit inside `for`/`while`/`switch`, the one position where (g) itself is refused, and
  only **10 of those 130** are admissible AND reachable from an output.
- The proof is a real script, not principle:
  `corpus/committed/inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat__832e485b9c.pine`
  declares `var float mhigh = na` (line 38), writes **`mhigh := high[1]`** inside an
  `if` (line 49), reads `mhigh` through `breakout` (line 70) into a `plotshape` (line
  74) — and `tools/corpus_metric.json` records it **`host: true`, `hostGuards: []`**.
  A series-typed reassignment, inside a block, read by an output, translated end to
  end with zero refusals. Same for
  `liquidity-engulfing-candles-upslidedown__0a521d089c.pine` (`host: true`, `[]`) and
  `average-day-range-adr-pivots__38b8c996e9.pine` (`host: true`, only
  `pine:constant-only`).
- **Only 13 of 266 corpus scripts refuse `pine:reassign` at all** in host mode
  (`corpus_metric.json`). Ten of the 13 carry a series-typed `:=`, and in only **4** of
  those does the refusing `:=` sit inside a `for` — the other 6 sit at top level or in
  an `if`, positions the engine otherwise folds.

**The defect that IS here** is the sentence, and it is fully traced below on
`bolingger-bands-inside-bar-boxes__3294017d4f.pine`: the member is told their
reassignment cannot be folded, when the real cause is a `varip` declaration three
statements away. The machinery to say the right thing (`unfoldable`) is already built,
already populated, and is **discarded on the branch that actually fires**.

---

## WHAT THE ENGINE DOES TODAY — measured by READING `pine.js`

### 1. There are THREE `:=` paths, and which one a use lands in is decided by WHERE the line sits

| path | file:line | what it does with `s := <series>` |
|---|---|---|
| top-level walk | `pine.js:11063–11095` | `prior.kind === 'state'` → `reassignState`; `prior.kind === 'expr'` → **rebind**, `env.set(name, exprBinding(rhs, new Map(env), locate(nameTok)))`; anything else → `throw PineRefusal('pine:reassign')` |
| block folder | `pine.js:9574–9605` (inside `foldStatements`, `pine.js:9474`) | identical three-way split; `op === ':='` takes the RHS node whole, `+=` desugars through `boundNode` |
| closing pass | `pine.js:11328–11353` | overrules both: any `:=` token the walk never consumed forces `pine:reassign` |

`reassignState` is `pine.js:8571`; `stateBinding` `pine.js:8589`; `exprBinding`
`pine.js:8615`.

### 2. Is the binding's TYPE tracked? **No — and there is nothing to track.**

A binding is `{kind: 'expr'|'state'|'vector'|'fn'|'opaque', node, env, at}`
(`pine.js:8615`, `8589`). It holds a **node**, and for `s := close` that node *is*
`{type:'series', name:'close'}`. The engine never records "s is a series" because the
series is the value it stores.

Pine's declared type word is **dropped on purpose**: `TYPE_WORDS` (`pine.js:1744`)
exists only so `boundName` (`pine.js:8497`) does not mistake `float` for the bound
name — `if (!tok || tok.kind !== 'ident' || TYPE_WORDS.has(tok.value)) return null`.
`float`, `int`, `bool`, `series float` are all discarded, and the census confirms the
corpus does not need them: the declared-type axis splits the population 13 ways and
**none of the splits changes the engine's behaviour** — `float x`, `var float x` and
bare `x =` all reach the same `exprBinding`/`stateBinding` code.

### 3. Is there a `pine:reassign` refusal, and what exactly triggers it?

`REFUSALS['pine:reassign']` (`pine.js:247–248`):

> `'a name that is reassigned later cannot be folded into one expression'`

Three triggers, all measured:

1. **`pine.js:10938`** — a `for`/`while`/`switch` at top level. Every
   `mutatorTargets(stmt.body)` name is forced opaque the instant the walk gives up,
   so any binding snapshot taken afterwards already sees the refusal.
2. **`pine.js:11069–11072`** — a top-level `:=` whose prior binding is missing or is
   not an `expr`/`state`. It re-raises the PRIOR guard when there is one, so a name
   already refused for another reason keeps that reason.
3. **`pine.js:11350`** — the closing pass, for any `:=` token left unconsumed. **This
   is the one that actually fires in the corpus, and it is where the sentence goes
   wrong.**

### 4. `forceOpaque` — and does a `:=` to a series invoke it?

`forceOpaque` is `pine.js:10697`. Unlike `markOpaque` (`pine.js:10683`) it **overwrites**
an existing binding, and since R7a it keeps the caller's reason alongside the composed
message:

```js
const forceOpaque = (name, guard, at, extra) => {
  env.set(name, { kind: 'opaque', guard, isFunction: false,
    message: `${REFUSALS[guard]}${extra ? ` — ${extra}` : ''}`,
    at: at || null,
    reason: extra || null })          // ⭐ R7a — kept so a later marker can carry it
}
```

A plain `s := close` **does not** invoke it. It invokes it only when the `:=` sits
inside a block the walk could not fold — and then it invokes it for **every** name that
block assigned, including names whose own statement is perfectly ordinary.

### 5. The `accumulatorNote` precedent — the shape a good refusal has

`accumulatorNote` is `pine.js:9280`. Its shape is: **name the real reason, give the
measurement, and name the binding constraint.**

```js
function accumulatorNote(stmt) {
  const hdr = stmt.header || []
  if (!hdr[0] || hdr[0].value !== 'for') return null
  if (hdr.some((tok) => tok && tok.kind === 'ident' && tok.value === 'in')) return null
  return 'a running total built inside a `for` is not folded into one expression on'
    + ' this lane — of 1,004 counted `for` loops in the reference corpus 379 do this,'
    + ' and only 1 of 379 has a seed, an update shape, an iteration count and a scope'
    + ' this engine can settle all at once (ruling R7). The binding constraint is the'
    + ' ITERATION COUNT: just 63 of 379 have a bound that folds before the chart runs'
}
```

Three properties worth copying: it **returns null** for anything that is not its own
case (so a sibling form keeps the sentence it had), it carries the **census numbers**,
and it names **which axis is binding**. `loopFormNote` (`pine.js:9293`) is its sibling
for `while` and `for … in`.

### 6. The sharp one: a HISTORY read on a reassigned binding

`s[k]` on a reassigned name is handled, by name, in three places:

- `Resolver.selfOffsetLag` (`pine.js:6010`) — `s[1]` **inside** `s`'s own update is
  `self`, `s[2]` is `self[1]`; the answer is `k - 1`, and the rail asserts `s[1]`
  produces the identical tree to bare `s`.
- `Resolver.plainRecurrence` (`pine.js:6026`) — `s[k]` **outside** its own update is
  the whole accumulator offset `k` bars, via `table.functions.accum`. It keys on
  `this.mutated` (the raw-token map from `reassignedNames`, `pine.js:8481`), **not on
  a declared type**.
- `Resolver.guardOffsetOfMutable` (`pine.js:6065`) — refuses `pine:state` when the
  binding in scope is not the last word on the name (`finalBindings.get(name) !== bound`
  and not in `finalLocals`).

So typing does not bite here: 321 of 1,649 population uses read `s[k]` later, and the
engine routes them by the mutation set. `adx-and-di-for-v4__932.pine:16`
(`SmoothedTrueRange := nz(SmoothedTrueRange[1]) - …`) is the specimen, and the door
refuses it **`pine:state`** — the correctly-named guard — not `pine:reassign`.

---

## DOES (g) TOUCH THE BLOCK WALK? **YES — this is a ruling trigger.**

The recorded ordering-defect class is documented at `pine.js:8980–8998`:

> `foldStatements` — the folder for the INSIDE of an `if` — never learned
> [destructures] at all, so `[a, b] = f()` within a branch fell through to "a bare
> expression", `parseWholeExpression` choked on the `=`, the chain refused, and every
> outer `var` the branch assigned was forced opaque as `pine:reassign`. … the refusal
> named `volD` — a name whose own statement is fine.

**(g) is the same class, one construct over, and the destructure repair did not cover
it.** Measured:

- `destructureBindings` (`pine.js:8999`) itself is **not** implicated by volume: only
  **28 of 1,649** population targets are bound by a `[a, b] = …` destructure.
- What IS implicated is the **same block walk and the same closing pass**: the
  top-level `if` catch at `pine.js:10842–10860` and the closing pass's `missed` branch
  at `pine.js:11328–11353`. A fix for (g) edits `foldStatements`'s surroundings, so it
  needs an owner ruling before it is attempted.

### The exact defect, traced on a real script

`corpus/committed/bolingger-bands-inside-bar-boxes__3294017d4f.pine` —
`corpus_metric.json` records `host: false`, **`hostGuards: ['pine:reassign']` and
nothing else**.

```
 97  varip int  barIndex = 1            <- the REAL cause
 98  varip bool IBStatus = false
124  if isIB and not isIB[1] and barstate.isconfirmed and DisplayIB
127          boxH := boxBodyHigh[1]     <- the line the member is told about
141          barIndex += 1
164  plotshape(showBreak and IBStatus and ta.crossover(close, boxH) and DisplayIB, …)
```

1. `varip int barIndex = 1` at top level: `STATE_KEYWORDS.has('varip')` is true but
   `word === 'var'` is false in both guarded branches (`pine.js:10803`, `10808`), so it
   falls to `markOpaque(name, 'pine:state', …)` (`pine.js:10824`). `barIndex` is opaque,
   guard `pine:state`.
2. Inside the `if` chain, `barIndex += 1` reaches `foldStatements`'s mutator branch
   (`pine.js:9574`): `prior.kind === 'opaque'` → **throws `pine:state`**, the chain's
   real reason.
3. The top-level `if` catch (`pine.js:10842`) stores that reason per name:
   `unfoldable.set(name, r)` for `boxH`, `boxL`, `IBStatus`, `myBox`, `barIndex`
   (`pine.js:10858`). **`consumeMutators` is NOT called on the throw path**, so every
   `:=` token in the chain stays unconsumed.
4. The closing pass (`pine.js:11328`):

```js
for (const [name, toks] of reassigned) {
  const missed = toks.find((t) => !ctx.consumed.has(t.index))
  const why = unfoldable.get(name)          // ⛔ the REAL reason, computed…
  if (missed) {
    const held = env.get(name)
    const reason = held && held.kind === 'opaque' && held.reason ? held.reason : `\`${name}\``
    forceOpaque(name, 'pine:reassign', locate(missed), reason)   // …and never read
  } else if (why && env.get(name) && env.get(name).kind !== 'opaque') {
    forceOpaque(name, why.guard, {…}, `\`${name}\``)             // `why` is used ONLY here
  }
}
```

`boxH`'s held binding is the `var float boxH = na` **state** binding, not opaque, so
`held.reason` is absent and `reason` falls back to `` `boxH` ``. The member reads:

> **`pine:reassign` — a name that is reassigned later cannot be folded into one
> expression — `boxH`**, at line 127

when the cause is a `varip` on line 97 in a sibling statement. `why` held
`pine:state` the whole time. This is the `accumulatorNote` shape precisely: a refusal
that fires correctly with a sentence that names the wrong fact, on a line whose own
statement is fine.

**6 of the 10 population scripts the door refuses `pine:reassign` have their refusing
`:=` in an `if` or at top level** — i.e. in a position the engine otherwise folds —
which is the signature of this path rather than of a real (g) gap.

---

## THE TABLE — one row per FORM (declared-type × RHS-kind × in-block)

`A&R` = admissible (no 12th `NODE_TYPES` member, no 42nd `REFUSALS` entry) **and**
reachable from an output **interprocedurally**. `dir` = the same count with line-based
reachability. `hist` = uses whose target is later read `s[k]`. The binding constraint
for every row is named as `file:line`.

```
#   declared          RHS kind          in block   uses files   A&R   dir  hist  binding constraint (a named corpus script)
-----------------------------------------------------------------------------------------------------------------------------------------
1   float             expr over series  if          121    24    52    16    10  72s-strategy-adaptive-hull-moving-average-pt:191
2   var float         series binding    if          109    26    33    17     3  auto-trendline-dojiemoji__c21f83602c.pine:119
3   bare  x =         expr over series  top-level    88    24    84    39    77  adx-and-di-for-v4__932.pine:16
4   var float         expr over series  if           88    24    36    31    12  auto-trendline-dojiemoji__c21f83602c.pine:120
5   var float         bare builtin      if           84    21    20     6    10  bolingger-bands-inside-bar-boxes__3294017d4f:84
6   bare  x =         call -> series    if           81    20    17     6     0  adaptive-trend-following-suite-alpha-extract:83
7   bare  x =         expr over series  if           78    24    24     5    21  atr-stop-loss-indicator__LOfv1FvRhL.pine:25
8   float             call -> series    if           75    16    20     2     0  advanced-custom-multi-ma-signals-emasmavwmav:125
9   int               call -> series    if           52     5     0     0     0  dual-view-htf-candlestick-patterns-theultima:625
10  bare  x =         expr over series  for          48    13     8     0    10  ai-supertrend-x-pivot-percentile-strategy-pr:280
11  bare  x =         expr over series  function     43    13    32     0    30  adaptive-trend-following-suite-alpha-extract:92
12  var float         call -> series    if           41    14    15     1     0  cvd-cumulative-volume-delta-candles__fb6471a:266
13  float             expr over series  for          41     2     0     0     0  poor-man039s-volume-profile__ZnFTCYyvGJ.pine:439
14  bare  x =         series binding    if           39    12     7     0     0  optimized-trend-tracker__ZhWiFvtpwE.pine:73
15  float             expr over series  else         36    13    28     9     3  deadband-hysteresis-filter-backquant__3fb3d0:40
16  float             expr over series  top-level    32    12    21    14    29  ai-supertrend-x-pivot-percentile-strategy-pr:118
17  var (untyped)     expr over series  if           32     9    12    12     4  inside-bar-strategy-w-sl__b39f395d5d.pine:162
18  float             series binding    if           31    11    15    10     6  advanced-custom-multi-ma-signals-emasmavwmav:147
19  var (untyped)     bare builtin      if           29     5     0     0     8  camarilla__jw9faob08r.pine:454
20  float             call -> series    else         27    10    14     1     0  advanced-custom-multi-ma-signals-emasmavwmav:127
21  var int           series binding    if           26     4     6     0     0  renderingnature-smc-reversal-engine-v71__f87:424
22  var float         call -> series    top-level    24     6    12     3     1  machine-learning-lorentzian-classification__:438
23  bare  x =         call -> series    for          23     6     0     0     0  anchored-vwap-pinch-handoff-intervals-and-si:281
24  var int           bare builtin      if           22     7     0     0     4  bigbeluga-smart-money-concepts__e41b7abd03.p:766
25  var float         expr over series  top-level    19     7    14     8    10  chart-champions-part-1-npoc-levels-vwaps__wd:123
26  var float         call -> series    else         17     5    14     8     4  initial-balance-ib-and-previous-day-week-hig:102
27  bare  x =         call -> series    function     15    11    12     0     9  adaptive-trend-following-suite-alpha-extract:72
28  float             series binding    else         14     5    10     5     1  advanced-custom-multi-ma-signals-emasmavwmav:149
29  bare  x =         expr over series  else         14     7     5     4     4  opening-range-initial-balance-opening-price_:42
30  int               series binding    if           14     1     1     0     0  volume-footprint-measuring-classical-indicat:793
31  var (untyped)     expr over series  top-level    13     4     3     3     3  opening-range-initial-balance-opening-price_:26
32  var (untyped)     series binding    if           12     4     6     6     0  order-block-finder__fVSb3j0I87.pine:129
33  var float         series binding    else         12     5     3     0     0  kalman-psar-backquant__0a389f529b.pine:90
34  bare  x =         series binding    else         10     2     0     0     0  auto-trendlines-tradingfinder-support-resist:175
35  no declaration    call -> series    if           10     5     0     0     1  bigbeluga-smart-money-concepts__e41b7abd03.p:1028
36  bare  x =         call -> series    top-level    10     5     2     1     6  deviation-scaled-moving-average-w-dsl-loxx__:112
37  bare  x =         bare builtin      if           10     2     8     8    10  opening-range-initial-balance-opening-price_:38
38  int               call -> series    else         10     3     0     0     0  dual-view-htf-candlestick-patterns-theultima:841
39  bool              expr over series  if           10     4     2     0     0  volatility-coil-edge-bullbyte__604f0fd1c6.pi:525
40  var int           expr over series  if            9     3     0     0     0  artemis-oscillator-pro__ea1097ca9e.pine:428
41  bool              expr over series  else          9     2     4     0     0  volatility-coil-edge-bullbyte__604f0fd1c6.pi:528
42  var float         expr over series  else          9     5     4     2     5  initial-balance-ib-and-previous-day-week-hig:105
43  bool              call -> series    if            8     3     0     0     0  candelacharts-equal-highslows-eqheql__4485a6:266
44  int               expr over series  top-level     8     2     4     0     8  trendlines__43QQg9nDN0.pine:55
45  float             call -> series    top-level     7     3     7     6     6  72s-strategy-adaptive-hull-moving-average-pt:180
46  float             bare builtin      if            7     4     5     1     5  72s-strategy-adaptive-hull-moving-average-pt:186
47  var (untyped)     series binding    top-level     7     3     2     2     0  ai-supertrend-x-pivot-percentile-strategy-pr:377
48  var float         expr over series  function      7     3     5     0     6  kalman-psar-backquant__0a389f529b.pine:95
49  float             call -> series    for           7     4     0     0     0  smt-divergence-ict-killzones__c932d56665.pin:339
50  bool              series binding    if            6     3     2     2     0  delta-imbalance-map-joat__b80f337fb3.pine:209
51  float             expr over series  function      6     5     3     1     5  multiple-mtf-moving-average-xdecow__aArjfk9S:73
52  var int           call -> series    if            6     4     0     0     0  higher-time-frame-fair-value-gap-zeroherotra:289
53  var float         bare builtin      else          5     3     4     0     2  bolingger-bands-inside-bar-boxes__3294017d4f:86
54  var int           series binding    else          5     3     0     0     0  fibonacci-retracement-statistics-by-volprofe:674
55  bool              call -> series    else          5     1     0     0     0  market-profile-with-tpo__b2b119d8ab.pine:309
56  bool              series binding    else          4     1     0     0     0  advanced-custom-multi-ma-signals-emasmavwmav:262
57  float             series binding    for           4     2     0     0     0  cvd-cumulative-volume-delta-chart__84da7a14b:422
58  var (untyped)     series binding    function      4     1     0     0     2  neural-network-buy-and-sell-signals__fbbb11d:556
59  var float         series binding    top-level     4     1     3     0     1  neural-network-buy-and-sell-signals__fbbb11d:616
60  series float      call -> series    if            4     1     0     0     0  smc-structures-and-multi-timeframe-fvg-ma-py:592
61  series int        call -> series    if            4     1     0     0     0  smc-structures-and-multi-timeframe-fvg-ma-py:593
62  series float      series binding    else          4     1     0     0     0  smc-structures-and-multi-timeframe-fvg-ma-py:606
63  series int        series binding    else          4     1     0     0     0  smc-structures-and-multi-timeframe-fvg-ma-py:607
64  var float         bare builtin      top-level     4     2     0     0     1  volatility-trend-score-backquant__0794882a37:62
65  bare  x =         series binding    function      3     2     3     0     0  boom-hunter-entry-point-screener-alerts__0fc:43
66  int               expr over series  if            3     3     0     0     0  ict-institutional-order-flow-fadi__25d483457:947
67  no declaration    call -> series    top-level     3     2     1     0     0  renderingnature-smc-reversal-engine-v71__f87:285
68  float             call -> series    function      3     1     0     0     0  std-filtered-adaptive-exponential-hull-movin:42
69  var (untyped)     expr over series  else          2     1     0     0     0  candlestick-patterns-on-backtest__c85b9d3ec6:240
70  no declaration    call -> series    else          2     1     0     0     0  fibonacci-retracement-statistics-by-volprofe:1123
71  no declaration    series binding    if            2     2     0     0     0  higher-time-frame-fair-value-gap-zeroherotra:209
72  bare  x =         call -> series    while         2     2     0     0     0  k-clustering__8e82f5aa4b.pine:168
73  bare  x =         series binding    top-level     2     1     2     0     0  keltner-center-of-gravity-channel__e4a81d76f:62
74  int               expr over series  for           2     1     2     0     0  order-block-finder__fVSb3j0I87.pine:48
75  var int           expr over series  function      2     1     0     0     0  smc-structures-and-multi-timeframe-fvg-ma-py:534
76  var bool          call -> series    top-level     2     1     2     0     2  trailing-take-profit-trailing-stop-loss__41j:255
77  var bool          series binding    if            2     2     0     0     0  uncharted-volume-v2.pine:415
78  int               expr over series  function      1     1     0     0     1  asianrange-and-killzones__ef41eb5ad6.pine:42
79  var (untyped)     call -> series    else          1     1     0     0     0  fx-market-sessions__3KZoMPYziy.pine:831
80  no declaration    expr over series  if            1     1     0     0     0  higher-time-frame-fair-value-gap-zeroherotra:165
81  int               expr over series  else          1     1     0     0     0  ict-institutional-order-flow-fadi__25d483457:952
82  int               call -> series    function      1     1     0     0     0  liquidity-heatmap-nephew-sam__7628c72c3d.pin:137
83  bare  x =         call -> series    else          1     1     1     0     0  parabolic-sar__xoeoPMOWGJ.pine:51
84  var (untyped)     call -> series    function      1     1     1     0     0  relative-volume-at-time__gei8CBKbc5.pine:162
85  var float         series binding    while         1     1     0     0     0  smart-money-concepts-by-welotrades__0bff41a2:1715
86  var bool          expr over series  top-level     1     1     1     1     0  volatility-stop-mtf__K5XG42uHV9.pine:196
87  var float         call -> series    for           1     1     0     0     0  volume-profile-v054beta__PNSKf75832.pine:212
88  var float         expr over series  for           1     1     0     0     0  volume-profile-v054beta__PNSKf75832.pine:255
89  var (untyped)     call -> series    top-level     1     1     0     0     1  zigzag-multi-time-frame-with-fibonacci-retra:33
```

### Threshold verdict per form (~20 admissible-and-reachable)

**10 of the 89 forms clear the threshold; 79 do not.** Every one of the 10 is already
in a position the engine folds — none of them is a build item for (g).

| # | form | A&R | verdict |
|---|---|---|---|
| 3 | `bare x =` · expr over series · **top-level** | 84 | BUILD candidate — **already works** |
| 1 | `float` · expr over series · `if` | 52 | BUILD candidate — **already works** |
| 4 | `var float` · expr over series · `if` | 36 | BUILD candidate — **already works** |
| 2 | `var float` · series binding · `if` | 33 | BUILD candidate — **already works** |
| 11 | `bare x =` · expr over series · **function body** | 32 | BUILD candidate — **already works** |
| 15 | `float` · expr over series · `else` | 28 | BUILD candidate — **already works** |
| 7 | `bare x =` · expr over series · `if` | 24 | BUILD candidate — **already works** |
| 16 | `float` · expr over series · **top-level** | 21 | BUILD candidate — **already works** |
| 5 | `var float` · **bare builtin** · `if` | 20 | BUILD candidate — **already works** |
| 8 | `float` · call → series · `if` | 20 | BUILD candidate — **already works** |

(rows 6, 12, 18, 20, 26 sit at 14–17, just under.) Every remaining form → **RETIRE:
refuse or note BY NAME at its own line with its number and routing**, which is what the
engine already does everywhere except for the sentence defect above.

The `for`/`while`/`switch` forms — rows 10, 13, 23, 49, 57, 72, 74, 85, 87, 88 — total
**130 uses, 10 admissible-and-reachable**, far under the threshold. That is the
item-(a)/(a4) unroll question, already ruled, and (g) adds nothing to it.

### Sensitivity — which axis is binding

```
  admissible                        1615 of 1649
  reachable, INTERPROCEDURAL         594 of 1649
  reachable, line-based only         230 of 1649     <- the axis that decides the headline
  target later read as `s[k]`        321 of 1649
  top-level        (folds today)     225 of 1649
  inside if/else   (folds today)    1208 of 1649
  inside a function(folds today)      86 of 1649
  inside for/while/switch (NOT)      130 of 1649
  every RHS call served             1440 of 1649
  target bound by a DESTRUCTURE       28 of 1649
```

**Admissibility is not the binding constraint** — 1,615 of 1,649 are admissible, i.e.
(g) needs no 12th `NODE_TYPES` member and no 42nd `REFUSALS` entry from almost any use.
**Reachability is**, and it more than doubles when measured interprocedurally
(230 → 594). A line-based check would have reported the headline as **230** instead of
**592**.

---

## THE HEADLINE

```
  admissible AND reachable                     : 592 of 1649 uses, 82 files
  the same count with LINE-BASED reachability  : 230
  of the admissible-and-reachable, read `s[k]` : 213
  of the admissible-and-reachable, in for/while/switch (refused today): 10
  of the admissible-and-reachable, top-level or if/else/function     : 582
  targets bound by a DESTRUCTURE (the recorded ordering-defect class)  : 28
```

**582 of 592 admissible-and-reachable uses sit where the engine already folds.**
The entire (g) opportunity outside that is **10 uses**, and they are the loop question,
not the typing question.

---

## THE CONTROL — verbatim

```
files scanned                        : 269  (266 corpus + 3 member fixtures)
statement-form `:=` reassignments     : 6143
compound `+=` and friends            : 479  (counted, a different desugaring)
  excluded, RHS not series-valued            : 3111
  excluded, declared drawing                 : 762
  excluded, declared colour                  : 144
  excluded, value is a collection            : 140
  excluded, declared string                  : 131
  excluded, value is a string                : 78
  excluded, value is a colour                : 65
  excluded, value is a drawing               : 63
THE POPULATION (RHS series-valued)   : 1649 uses in 158 files

--- CONTROLS ---
CONTROL: stripper-sees-all-3-unstripped     expected 3                      got 3                      OK
CONTROL: stripper-leaves-the-1-real-one     expected 1                      got 1                      OK
CONTROL: ordering-reassign-finds-only-b     expected 1                      got 1                      OK
CONTROL: ordering-compound-finds-only-g     expected 1                      got 1                      OK
CONTROL: ordering-declare-finds-only-a      expected 1                      got 1                      OK
CONTROL: ordering-naive-would-take-3        expected 3                      got 3                      OK
CONTROL: comma-joined-statement-split       expected 1                      got 1                      OK
CONTROL: tuple-destructure-not-split        expected 1                      got 1                      OK
CONTROL: named-arg-not-a-declaration        expected 0                      got 0                      OK
CONTROL: ternary-condition-is-not-a-value   expected ['upcol', 'downcol']   got ['upcol', 'downcol']   OK
CONTROL: NODE_TYPES-frozen-11               expected 11                     got 11                     OK
CONTROL: REFUSALS-frozen-41                 expected 41                     got 41                     OK
CONTROL: pine-reassign-is-in-REFUSALS       expected True                   got True                   OK
CONTROL: served-calls-read-from-table       expected 72                     got 72                     OK
CONTROL: corpus-scripts                     expected 266                    got 266                    OK
CONTROL: door-host-ok                       expected 32                     got 32                     OK
CONTROL: scripts-the-door-refuses-reassign  expected 13                     got 13                     OK
CONTROL: reassign-refusals-explained        expected 13                     got 13                     OK
  anti-vacuity for `reassign-refusals-explained`: the same predicate fires on 201 of 269 files

all controls OK
```

`main()` returns **1** if any control mismatches; the run above exits **0**.

The load-bearing control is **`reassign-refusals-explained`**. It re-derives a number
the engine measured, not one this tool also produced: for every one of the 13 scripts
`tools/corpus_metric.json` records the shipped door refusing `pine:reassign`, the
census must independently find at least one `:=` that is not a plain top-level
reassignment of a name it also found a declaration for. Its anti-vacuity number (201 of
269) is printed beside it, because a predicate that fired everywhere would "explain"
all 13 and mean nothing.

---

## g.4 EVIDENCE — the shipped door's own measured answer

From `tools/corpus_metric.json` (`measured_at: 2026-09-15`, 266 scripts):

```
  corpus scripts in the population                 : 156
  of those the door translates END TO END (host ok): 8
  of those the door refuses `pine:reassign`        : 10

  scripts carrying a REACHABLE ADMISSIBLE series-typed `:=` that the door translates END TO END:
    average-day-range-adr-pivots__38b8c996e9.pin :432   `result := ta.ema(_source, _length)`  [float, if]
    average-day-range-adr-pivots__38b8c996e9.pin :435   `result := ta.sma(_source, _length)`  [float, if]
    inside-bar-range-mother-candle-breakoutbreak :49    `mhigh := high[1]`                    [var float, if]
    inside-bar-range-mother-candle-breakoutbreak :50    `mlow := low[1]`                      [var float, if]
    liquidity-engulfing-candles-upslidedown__0a5 :25    `bull_engulf := bull_engulf and low…` [bare x =, if]
    liquidity-engulfing-candles-upslidedown__0a5 :26    `bear_engulf := bear_engulf and high…`[bare x =, if]
  -> 3 script(s) of the 8 host-ok scripts in the population.

  scripts the door refuses `pine:reassign` - where the refusing use SITS:
    bolingger-bands-inside-bar-boxes__3294017d4f :84    in if        reached=True  (for/while/switch uses here: 0)
    delta-imbalance-map-joat__b80f337fb3.pine    :209   in if        reached=True  (for/while/switch uses here: 0)
    ict-turtle-soup-flux-charts__053c3e6056.pine :140   in if        reached=False (for/while/switch uses here: 0)
    inside-bar-boxes__2f747d848b.pine            :54    in if        reached=True  (for/while/switch uses here: 0)
    machine-learning-moving-average-backquant__4 :109   in top-level reached=True  (for/while/switch uses here: 0)
    renderingnature-smc-reversal-engine-v71__f87 :285   in top-level reached=True  (for/while/switch uses here: 0)
    smart-money-concepts-by-welotrades__0bff41a2 :538   in for       reached=False (for/while/switch uses here: 7)
    smt-divergence-ict-killzones__c932d56665.pin :339   in for       reached=False (for/while/switch uses here: 2)
    support-and-resistance-logistic-regression-f :92    in for       reached=False (for/while/switch uses here: 1)
    williams-fractal-trailing-stops__UOOIN5REYl. :158   in for       reached=False (for/while/switch uses here: 2)
```

**An absence here would be evidence only if a presence could have been seen, and it
can:** three host-ok scripts carry a reachable, admissible, series-typed `:=` and
translate with zero refusals. The instrument that reports them is the same one that
reports the 130 `for`/`while`/`switch` uses it cannot serve, on the same pass.

---

## DEFECTS FOUND IN THIS INSTRUMENT WHILE BUILDING IT

Four, all found by reading the instrument's own table or its own control line — none by
review.

1. **⚰️ A STATEMENT IS NOT A LINE — the load-bearing control caught it.** v1 anchored
   `:=` at the head of a line. `reassign-refusals-explained` came back **12 of 13** and
   named `3-level-zigzag-semafor__3078.pine`, which writes
   `int _direction = na , _direction := switch` — Pine's comma-joined statements, the
   same split `pine.js::blockStatements` performs. The census reported **zero** `:=` in
   a file the shipped door refuses `pine:reassign`. Fixed: every line is split on
   TOP-LEVEL commas before matching (`split_statements`), with a control proving a
   tuple destructure `[a, b] = f(x, y)` is *not* split.

2. **⚰️ A CONDITION IS NOT A VALUE POSITION.** v1's `is_series` answered "does a series
   name appear anywhere in the text". `V_COL := close > open ? upcol : downcol` mentions
   `close` and `open` and its value is a **colour** — 54 such uses in
   `volume-suite-by-leviathan__48da793360.pine` alone were counted as a series-typed
   reassignment, and the row sat at **A&R 54**, which would have been the third-largest
   finding in the table. Fixed: `value_parts` strips the condition of every top-level
   ternary and the kind is asked before the literal. Control:
   `ternary-condition-is-not-a-value`.

3. **⚰️ DRAWING HANDLES ARE NOT SERIES.** v1's two largest rows were
   `var label` × `call -> series` (168 uses) and `var line` × `call -> series` (148) —
   `lbl := label.new(bar_index, high, …)`, counted as series-typed because a price
   appears in the ARGUMENTS. 422 uses of pure noise at the top of the table. Fixed:
   drawing, collection, colour and string values are excluded **by name**, each with the
   refusal code that already owns it (`pine:drawing`, `pine:collection`,
   `pine:colour-value`, `pine:text-value`) — so the exclusion is a routing statement,
   not a filter. The excluded counts are printed rather than hidden (1,383 of 6,143).

4. **⚰️ `=>` SLIPPED PAST THE DECLARATION ANCHOR.** `ordering-declare-finds-only-a`
   came back **2**: `(?!=)` rejected `==` but not `=>`, so `h => close` read as a
   declaration of `h`. And `ordering-naive-would-take-3` was written expecting **2** and
   measured **3** — the naive reader is worse than predicted, taking `a = close`,
   `c == close` **and** `h => close`. Fixed to `(?![=>])`; both expected values are now
   the measured ones.

**Also checked and found clean** (an absence stated, with what was looked at):
- multi-line function bodies in interprocedural reachability — the first cut captured
  only a `f() => tail`, which is empty for every multi-line function; caught before it
  reached a number and fixed to take the whole indented block (`_block_below`).
- named arguments on continuation lines (`plot(close,\n  title = "x")`) — the
  bracket-depth continuation skip was present from the first version and its control
  (`named-arg-not-a-declaration`) has never failed.
- substring matching on history reads — `\b([A-Za-z_]\w*)\s*\[` is word-bounded, so
  `bars[1]` is not `s[1]`.
- cycle guards on the kind walk — `s := s + close` names its own target; `value_kind`
  carries a `seen` set and a per-name memo.
- `bar_index` is deliberately not in `SERIES_BUILTINS`: it is a bar counter, and
  admitting it would have dragged every `i := bar_index` into a census about price
  typing. Stated in the source rather than left as a silent choice.
