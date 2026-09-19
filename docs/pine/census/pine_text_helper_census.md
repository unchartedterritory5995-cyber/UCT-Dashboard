# Item (f) — NESTED TEXT HELPERS

Instrument: `tools/pine_text_helper_census.py` · run as `python tools/pine_text_helper_census.py`
from the worktree root. Read-only: no network, no server, no vendor call, no write outside
stdout. **Nothing under `C:\data` was read or written.** The engine measurements in
"what the engine does today" were taken by importing the shipped `pine.js` in plain node
and reading what `translatePine` returns; nothing in the engine was modified.

Corpus: `corpus/committed` (266) + `tests/fixtures/pine_oos` (120) + `tests/fixtures/member`
(3) = **328 scripts**. The three-directory scope is the precedent one — (b), (c) and (d) all
use it — and it is what reproduces d2's committed 555/338/149/2, which is this census's
control.

---

## HEADLINE

**3,382 nested text-helper uses in the corpus. 2,242 of them are ALREADY CARRIED by the
shipped engine — every one of them TEXT-yielding, every one of them into a drawing's
`text=`/`tooltip=` slot, and none of them needing a 12th node type. Zero NUMBER-yielding
nested uses are admissible today, and not because the engine lacks the members: it holds
four of them, and every one of the corpus's 30 nested number-yielding sites hands them an
operand `textOperandOf` cannot take.**

So item (f) is not a build item in the direction the question implies. The nested-text-helper
demand is concentrated in ONE place the engine already serves, and what the census actually
sizes is four *gaps beside* it:

| gap | uses | what it is |
|---|---|---|
| `str.*` members the object lane cannot read in a text slot | **36** | `str.format`/`upper` in a `label`/`table` `text=` — the whole cell is dropped |
| Pine's METHOD spelling `tbl.cell(…)` | **123** | invisible to `collectObjectOps`, not even a drop reason |
| helpers whose PARENT refuses before they are read | **128** | `str.length(_raw)` inside `str.substring(…)` |
| number-yielders absent from `PINE_TEXT_PREDICATE` | **5** | `str.tonumber`, `str.pos` — a textop each, no node type |

---

## WHAT THE ENGINE DOES TODAY — read off `pine.js`, then measured through the door

### Which `str.*` members it knows, and what each translates to

| member | file:line | translates to | result kind |
|---|---|---|---|
| `str.contains` | `pine.js:1265`, folded `pine.js:6703` | `cNum(0/1)` when both operands are literals, else `{type:'textop', name:'contains'}` | **NUMBER** |
| `str.startswith` | `pine.js:1266`, `:6703` | same shape | **NUMBER** |
| `str.endswith` | `pine.js:1267`, `:6703` | same shape | **NUMBER** |
| `str.length` | `pine.js:1268`, `:6703` | `cNum(n)` / `{type:'textop', name:'length'}` | **NUMBER** |
| `str.tostring` / bare `tostring` | `pine.js:9919` | `{t:'num', tree, fmt?}` — a PRESENTATION node on an object op, **not** a tree node | TEXT, carried |
| **every other `str.*`** | `NAMESPACE_GUARD.str` `pine.js:572`, thrown `pine.js:6731` | `PineRefusal('pine:builtin', "… — \`str.format\`")` | refused BY NAME |

⭐ `PINE_TEXT_PREDICATE` is tried **before** the `str` namespace guard and falls through to
it (`pine.js:6698-6702` states exactly that, on the shape `request.security` established).
The four are admissible only because **both operands are bind-time**: `textOperandOf`
(`pine.js:5308`) returns a `str` node for a literal and a `symtext` node for
`syminfo.ticker|tickerid|prefix` (`BUILTIN_SYMBOL_SCOPED`, `pine.js:1228`), and **null for
anything else** — including a nested call. When it returns null for any operand, the whole
call falls to `pine:builtin`.

Measured through the shipped door:

```
A length(literal)            ok=true  formula="close * 4"
A length(syminfo.ticker)     ok=true  formula="close * text_length(syminfo('ticker'))"
A contains(sym,"/")          ok=true  formula="text_contains(syminfo('ticker'), '/') ? high : low"
B length(str.tostring(x))    ok=false refusal=pine:builtin
                                      "…the engine grammar does not hold — `str.length`"
C plot(str.format)           ok=false refusal=pine:builtin  "… — `str.format`"
```

### Where string concatenation goes — and it is NOT distinguished from numeric `+`

There is **no type test anywhere that separates a string `+` from a numeric `+`.** The same
`binary` parse node is read twice, by two different readers, and the POSITION decides:

| reader | file:line | what `+` becomes |
|---|---|---|
| `Resolver.resolve` (the value lane) | `pine.js:5756` onwards | an arithmetic `op`; a `string` operand throws `pine:text-value` at `pine.js:5739` |
| `textNodeOf` (the object/text lane) | `pine.js:9940` | `{t:'cat', args:[a, b]}` — and `null` if either side cannot be read |

`textNodeOf` is only entered for `TEXT_SLOTS = {'text','tooltip'}` (`pine.js:10078`, dispatched
at `pine.js:10102`). Everywhere else a concatenation is an arithmetic expression that will
refuse on its string operand.

### What happens to a `str.*` call nested inside another call's argument list

**It depends entirely on the OUTER call, because the engine resolves outside-in.** There is
no nesting-specific handling at all; four different outcomes, none of them "folded":

| outer position | outcome | file:line |
|---|---|---|
| a drawing's `text=`/`tooltip=`, helper is `str.tostring` or `+` | **carried** as `{t:'num'}` / `{t:'cat'}` | `pine.js:9919`, `:9940` |
| a drawing's `text=`, helper is any other `str.*` | falls to `canonicalOf` → `pine:builtin` is caught → `unresolvedValues += 1` (`pine.js:9828`) → the property is null → **the cell is dropped whole**, `dropReasons['cell:text']` | `pine.js:10478` |
| a value position (plot series, arithmetic, a `math.*`/`ta.*` argument) | the four predicates fold if their operands are bind-time; **everything else refuses `pine:builtin` BY NAME** | `pine.js:6703`, `:6731` |
| inside a refused parent (`str.substring(… str.length(x) …)`, `array.push`, `alert`, `log.*`) | the parent throws first; the inner node is never resolved | `pine.js:6731` |

### The exact refusal / note codes

| code | kind | where |
|---|---|---|
| `pine:builtin` | **REFUSAL** (in the frozen 41-code `REFUSALS` table) | `pine.js:6731` for the `str` namespace, `pine.js:6737` for a bare name |
| `pine:text-value` | REFUSAL | `pine.js:5739` — a bare string in a value position |
| `pine:alert-message` | **NOTE** (`noteOf`, `pine.js:8461`) | `pine.js:11612` — an alertcondition message this lane cannot carry |
| `pine:chart-only` | NOTE, never thrown | `pine.js:8443` — `alert()` and the paint calls |
| `cell:text`, `create:label` | a `dropReasons` counter, **not** a refusal and **not** a note | `pine.js:10478` |

**No 42nd refusal code is minted anywhere in this subject, and none is needed.** Every
outcome above already has a name.

### ⛔ The engine's own `nestedTextHelpers` diagnostic is NOT this item

`pine.js:10030` records a diagnostic literally called `nestedTextHelpers`. It is about a
nested **USER FUNCTION** inside a text expression (`f_outer(x) => '[' + f_inner(x) + ']'`),
refused by name because two levels would need the frame CHAIN. It is **not** about a nested
`str.*`, it fires on zero corpus scripts today, and `textUserFunction.test.js:162` pins its
only known firing on a fixture. Anyone reading this item's name against that diagnostic is
reading two different things.

---

## f.2 — THE POPULATION

**3,382 nested uses** (depth ≥ 1) against **2,772 standing alone**; 6,154 helper nodes total.

| nesting depth | uses |
|---|---|
| 1 | 3,207 |
| 2 | 163 |
| 3 | 10 |
| 4 | 1 |
| 5 | 1 |

| result kind | uses | files |
|---|---|---|
| **TEXT** | 3,349 | 150 |
| **NUMBER** | 30 | 10 |
| ARRAY (`str.split`) | 3 | 3 |

| outermost consumer | uses | | outermost consumer | uses |
|---|---|---|---|---|
| `label.*` text/tooltip | 1,349 | | `table.*` text (METHOD spelling) | 78 |
| `table.*` text/tooltip | 847 | | `log.*` | 41 |
| `alert()` | 250 | | `request.security` symbol | 36 |
| other call | 206 | | user-fn (unresolved) | 29 |
| `input.*` cosmetic (title/tooltip) | 167 | | `strategy.*` | 20 |
| `array`/`matrix`/`map` | 116 | | `table.*` other (METHOD) | 17 |
| `box.*` text | 95 | | `label.*` text (METHOD) | 15 |
| inside another `str.*` | 84 | | `table.*` non-text / `?.text` / `math.*` | 32 |

**401 of those consumers were resolved ONE LEVEL through a user function** — the depth
`textNodeOf` itself inlines (`pine.js:10038`). Without that step they read as "handed to a
function that draws nothing": 153 → `label.*` text, 148 → `table.*` text, 46 → another call,
24 → `box.*` text, 24 elsewhere.

| reaches (interprocedural) | uses |
|---|---|
| a DRAWING | 2,677 |
| nothing | 617 |
| an OUTPUT (`plot`/`alertcondition`) | 88 |

⛔⛔ **ZERO text-helper uses sit textually inside a `plot`-family call or an
`alertcondition(` — at ANY depth, in all 328 scripts.** Not one. The 88 that "reach an
output" do so only through the interprocedural walk: the value is bound to a name that a
`plot`/`alertcondition`/`fill`/`bgcolor` line later reads (43 written inside an ordinary
call, 26 inside `alert()`, 10 inside another `str.*`, 5 inside `math.*`, 4 inside an
`input` tooltip). **Item (f) lives on the object/drawing lane and nowhere else**, and that
single measurement settles more of f.4(i) than the two messages do.

---

## f.3 — THE TABLE (one row per FORM)

`USES` counts helper NODES. `ARGS` counts distinct consuming ARGUMENTS, because
`label.new(text = "x " + str.tostring(v))` is ONE demand written with TWO helper nodes and
reading USES as demands double-counts every concatenation. `ADM+RCH` is admissible **and**
reaching an output or a drawing — the number the threshold turns on.

| helper | outermost consumer | binding constraint | uses | args | files | adm+rch | named script |
|---|---|---|---|---|---|---|---|
| `+` | `label.*` text | `pine.js:9940` | 787 | 424 | 50 | **782** | `all-chart-patterns-theeccentrictrader__03e4633d31.pine:387` |
| `str.tostring` | `label.*` text | `pine.js:9919` | 545 | 459 | 60 | **541** | `all-chart-patterns-theeccentrictrader__03e4633d31.pine:387` |
| `+` | `table.*` text | `pine.js:9940` | 450 | 248 | 51 | **448** | `4c-nyse-market-breadth-ratio__722410befd.pine:35` |
| `str.tostring` | `table.*` text | `pine.js:9919` | 377 | 327 | 57 | **376** | `4c-nyse-market-breadth-ratio__722410befd.pine:35` |
| `+` | `alert()` | `pine.js:8443` (note) | 172 | 67 | 20 | 0 | `72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt.pine:136` |
| `+` | `input.*` cosmetic | `Resolver.resolveInput` | 167 | 82 | 11 | 0 | `atr-bands__ad60b125e6.pine:22` |
| `+` | other call | `pine.js:5739` | 129 | 86 | 19 | 0 | `atr-god-strategy-by-tradesmart__4369755a29.pine:443` |
| `+` | `array`/`matrix`/`map` | `pine.js:570`/`6731` | 75 | 44 | 12 | 0 | `auto-trendlines-tradingfinder-support-resistance__…pine:340` |
| `str.tostring` | `alert()` | `pine.js:8443` | 70 | 46 | 14 | 0 | `72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt.pine:136` |
| `str.tostring` | other call | `pine.js:6731` | 57 | 53 | 15 | 0 | `bigbeluga-smart-money-concepts__e41b7abd03.pine:705` |
| `+` | `box.*` text | `pine.js:9940` | 50 | 26 | 7 | **50** | `average-day-range-adr-pivots__38b8c996e9.pine:216` |
| `str.tostring` | `box.*` text | `pine.js:9919` | 45 | 27 | 9 | **45** | `average-day-range-adr-pivots__38b8c996e9.pine:216` |
| `+` | `table` text, METHOD spelling | `pineObjects.js:88/265` | 45 | 22 | 6 | 0 | `high_engagement__08-market-structure-break-o….pine:322` |
| `str.tostring` | `array`/`matrix`/`map` | `pine.js:570` | 36 | 25 | 7 | 0 | `candlestick-patterns-on-backtest__c85b9d3ec6.pine:169` |
| `+` | `request.security` symbol | `pine.js:6690` | 36 | 12 | 2 | 0 | `open-interest-profile-fixed-range-by-leviathan__…pine:122` |
| `str.tostring` | `table` text, METHOD spelling | `pineObjects.js:88/265` | 33 | 30 | 6 | 0 | `high_engagement__08-market-structure-break-o….pine:322` |
| `str.tostring` | inside another `str.*` | `pine.js:6731` | 24 | 24 | 3 | 0 | `high_engagement__24-coppock-curve-multi-filt….pine:317` |
| `+` | `log.*` | `pine.js:572`/`6731` | 23 | 15 | 6 | 0 | `cvd-cumulative-volume-delta-candles__fb6471a4d….pine:374` |
| **`str.length`** | inside another `str.*` | `pine.js:5308`/`6731` | 20 | 20 | 5 | 0 | `auto-trendlines-tradingfinder-support-resistance__…pine:356` |
| `+` | `strategy.*` | `pine.js:563` | 20 | 10 | 1 | 0 | `trailing-take-profit-trailing-stop-loss__41j….pine:309` |
| `+` | user-fn (unresolved) | — | 19 | 15 | 3 | 0 | `correlation-matrix__dzN3DMCFJL.pine:109` |
| **`str.format`** | `table.*` text | `pine.js:9919` | 17 | 17 | 4 | 0 | `black-scholes-option-pricing-model-w-greeks-loxx…pine:475` |
| **`str.format`** | `label.*` text | `pine.js:9919` | 17 | 17 | 4 | 0 | `chart-vwap__804099ca2f.pine:133` |
| `str.tostring` | `log.*` | `pine.js:572` | 17 | 14 | 5 | 0 | `smart-money-concepts-by-welotrades__0bff41a2e5.pine:692` |
| `+` | `table.*` non-text | `pine.js:5739` | 14 | 7 | 7 | 0 | `cvd-cumulative-volume-delta-candles__fb6471a4d….pine:346` |
| `+` | inside another `str.*` | `pine.js:6731` | 14 | 11 | 5 | 0 | `cvd-cumulative-volume-delta-candles__fb6471a4d….pine:350` |
| `+` / `str.tostring` | `table`/`label` other, METHOD | `pineObjects.js:265` | 17+12 | — | 1–2 | 0 | `open-interest-suite-aggregated-by-leviathan__…pine:260` |
| `str.format` | `alert()` | `pine.js:8443` | 8 | 8 | 2 | 0 | `ict-killzones-pivots-tfo__d0b8be94f1.pine:556` |
| `str.format_time` | other call | `pine.js:6731` | 7 | 5 | 1 | 0 | `ict-killzones-pivots-tfo__d0b8be94f1.pine:400` |
| `str.substring` | inside another `str.*` | `pine.js:6731` | 6 | 6 | 1 | 0 | `ict-killzones-pivots-tfo__d0b8be94f1.pine:704` |
| `str.trim` | inside another `str.*` | `pine.js:6731` | 6 | 6 | 1 | 0 | `ict-killzones-pivots-tfo__d0b8be94f1.pine:769` |
| **`str.tonumber`** | other call | `pine.js:1264` (absent) | 5 | 5 | 3 | 0 | `fibonacci-retracement-statistics-by-volprofex__…pine:430` |
| `str.format` | other call | `pine.js:6731` | 5 | 5 | 1 | 0 | `ict-killzones-pivots-tfo__d0b8be94f1.pine:400` |
| `str.replace_all` | inside another `str.*` | `pine.js:6731` | 5 | 5 | 3 | 0 | `ict-killzones-pivots-tfo__d0b8be94f1.pine:710` |
| `str.format_time`/`+`/`str.tostring`/`str.format` | `?.text`, METHOD spelling | `pineObjects.js:265` | 13 | — | 1–2 | 0 | `ict-killzones-pivots-tfo__d0b8be94f1.pine:294` |
| `str.lower` | inside another `str.*` | `pine.js:6731` | 3 | 3 | 2 | 0 | `candlestick-patterns-on-backtest__c85b9d3ec6.pine:370` |
| `str.substring` | other call | `pine.js:6731` | 3 | 3 | 2 | 0 | `fibonacci-retracement-statistics-by-volprofex__…pine:430` |
| **`str.pos`** | inside another `str.*` | `pine.js:1264` (absent) | 2 | 2 | 2 | 0 | `high_engagement__18-cross-correlation-kioseff….pine:72` |
| **`str.length`** | `math.*` | `pine.js:5308` | 2 | 2 | 1 | 0 | `renko-candles-overlay__d76a18d49e.pine:26` |
| `str.tostring` | `math.*` | `pine.js:6731` | 2 | 2 | 1 | 0 | `renko-candles-overlay__d76a18d49e.pine:26` |
| **`str.upper`** | `table.*` text | `pine.js:9919` | 2 | 2 | 1 | 0 | `mid_engagement__08-hourly-alpha-profile-term….pine:189` |
| `str.split` / `str.format_time` / `str.replace` / `str.contains` | collection, `math.*`, inside `str.*`, `log.*` | `pine.js:570`/`6731` | 1 each | — | 1 | 0 | `htf-liquidity-dashboard-tfo__ec8f8316a4.pine:68` |

### THRESHOLD VERDICT PER FORM (~20 admissible-and-reachable)

| form | adm+rch | verdict |
|---|---|---|
| `+` → `label.*` text | 782 | **BUILD → already shipped; KEEP AND DO NOT REGRESS** |
| `str.tostring` → `label.*` text | 541 | **BUILD → already shipped; KEEP AND DO NOT REGRESS** |
| `+` → `table.*` text | 448 | **BUILD → already shipped; KEEP AND DO NOT REGRESS** |
| `str.tostring` → `table.*` text | 376 | **BUILD → already shipped; KEEP AND DO NOT REGRESS** |
| `+` → `box.*` text | 50 | **BUILD → already shipped; KEEP AND DO NOT REGRESS** |
| `str.tostring` → `box.*` text | 45 | **BUILD → already shipped; KEEP AND DO NOT REGRESS** |
| **every other form — all 44 of them** | **0** | **RETIRE**, named individually below |

⛔ **Every row over the threshold is already shipped, so "BUILD" there means "keep and do
not regress", not "start work".** Nothing in item (f) crosses 20 as *new* work. The forms
that are refused or unread are named here at their own line with their number and routing,
which is what the threshold rule asks for when a form is under it:

| RETIRED form | uses | routing |
|---|---|---|
| `str.format` → a drawing `text=` slot (`label` 17 + `table` 17), `str.upper` → `table` text 2 | **36** | The only reader-shaped gap in (f). `textNodeOf` would need to know `str.format`; the arguments are already numbers it can resolve. **Under 20 per member — refuse and note, do not build.** Named: `chart-vwap__804099ca2f.pine:133`, `black-scholes-option-pricing-model-w-greeks-loxx…pine:475`, `mid_engagement__08-hourly-alpha-profile-term….pine:189` |
| Pine METHOD spelling `tbl.cell(…)`, `.set_text(…)` | **123** | ⚠️ **NOT (f)'s to fix — it is `pineObjects.js`'s.** The call is invisible to `collectObjectOps` (`pineObjects.js:88`, `:265`), so the object pass emits nothing, records no drop and produces no diagnostic. **Silence, not a refusal.** 123 uses across 8 scripts is above 20 and this is the one number in the census that argues for work — routed to the OBJECT pass, not to a node type. Named: `high_engagement__08-market-structure-break-o….pine:322` |
| helpers under a refusing parent | **128** | No action. `str.length(_raw)` inside `str.substring(…)` cannot fold while `str.substring` refuses, and `str.substring` is 9 uses in 2 files. Named: `auto-trendlines-tradingfinder-support-resistance__…pine:356` |
| `str.tonumber` 5 + `str.pos` 2 | **7** | **Admissible in principle with NO 12th node type** — both yield numbers, both would be `textop`s. Well under 20. **RETIRE**; add to `PINE_TEXT_PREDICATE` only if a member asks. Named: `fibonacci-retracement-statistics-by-volprofex__…pine:430`, `high_engagement__18-cross-correlation-kioseff….pine:72` |
| `alert()` 250 + `log.*` 41 | **291** | Chart-/runtime-only. `alert` is already noted `pine:chart-only`; **item (d) territory, already ruled.** |
| `input.*` title/tooltip | **167** | Not a value. `resolveInput` folds the DEFVAL only. **No demand.** |
| `array`/`matrix`/`map` arguments | **116** | `pine:collection`. **The IR lane's — item (c)/(a).** |
| `+` in a `request.security` SYMBOL | **36** | A computed symbol, declines `pine:request`. **Item (c)'s**, and a `sym` field rather than a `str` node. Named: `open-interest-profile-fixed-range-by-leviathan__…pine:122` |
| `strategy.*` alert text | **20** | `pine:strategy-call`. Out of scope for this lane. |
| TEXT into a general expression position | **216** | The only genuine 12th-node-type demand in the corpus, and it is spread over `other-call` (129 + 57), non-text drawing slots (14) and unresolved helpers. **Under 20 for every single (helper × consumer) form.** RETIRE. |

---

## f.4(i) — ARE d2's TWO NOTED MESSAGES NESTED TEXT HELPERS?

**No. They are not text helpers of any kind, and they are not expressions. They are plain
string literals, and the shipped engine already carries both.**

The two are:

```
corpus/committed/neural-network-buy-and-sell-signals__fbbb11d0c7.pine:966
  alertcondition(…, "Premium Buy Signal (A+)",  "PREMIUM BUY Signal - Grade A+ - Highest confidence bullish signal")
corpus/committed/neural-network-buy-and-sell-signals__fbbb11d0c7.pine:968
  alertcondition(…, "Premium Sell Signal (A+)", "PREMIUM SELL Signal - Grade A+ - Highest confidence bearish signal")
```

The (d) census's `shape_of` asked `'+' not in a` over the **whole argument text, quotes
included** (`tools/pine_alert_census.py`, `shape_of`), so the `+` in **"Grade A+"** read as
concatenation. The engine asks the parser instead — `outputMessage` (`pine.js:12902`) carries
the value iff `value.type === 'string'` — so it disagrees. Measured through the door:

```
literal-containing-plus     message="Grade A+ - highest confidence"   pine:alert-message notes=0
genuine-concat-expr         message=null                              pine:alert-message notes=1
named-literal               message="NAMED"                           notes=0
placeholder                 message="px {{close}}"                    notes=0
nested-str-format           message=null                              notes=1
nested-str-tostring-only    message=null                              notes=1
```

and on the corpus script itself, `translatePine` emits **0** `pine:alert-message` notes at
lines 966/968.

**Consequences, in the order they matter:**

1. **d2's note has ZERO corpus firings.** With a string-aware classifier the corpus has
   **340 literal + 149 placeholder + 66 absent = 0 expression messages** out of 555. The
   `pine:alert-message` note is real, fires correctly on a synthetic, and is unreachable from
   any script in the corpus. The `487 of 555` figure in `alertMessageRides.test.js:10` and
   `silenceSpeaks.test.js:9` should read **489 of 555**, and the "2 genuine expressions"
   sentence in both files and in `pine.js:12898` is wrong.
2. **The answer to "would d2's carriage extend to them" is that it already has.** Nothing is
   needed, no node type is implied, and no work follows from these two lines.
3. **The question of a nested text helper in an `alertcondition` message is not sized by
   these two.** The census answers it separately and the answer is **zero**: across 328
   scripts, **no text helper of any kind appears textually inside an `alertcondition(` — or
   inside a `plot`-family call — at any nesting depth.** So there is no nested-text-helper
   message for d2's carriage to extend to, and no plot title either.
4. **If such a message did exist, could it resolve to a string at plan time?** For a literal
   concatenation of literals, yes — `stringValueOf` (`pine.js:5281`) already folds a bound
   name, an `input` default and a `string` node, and `outputMessage` could call it instead of
   testing `value.type` directly. That is a **carriage change with no new node type.** For a
   per-bar message (`"px " + str.tostring(close)`), no: the value is a series. Carrying it
   would need either a tree-valued message field (still carriage, still no 12th node type,
   exactly the `{t:'cat'}` shape `textNodeOf` already builds) or a `str` node parented by
   something other than a `textop`, which `assertCanonical` (`parse.js:1555`) forbids.
   **Neither is warranted at a corpus count of zero.**

---

## f.4(ii) — NUMBER vs TEXT, AND WHETHER "ALREADY WORKING" IS TRUE

| result kind | nested uses | files | admissible today | reachable |
|---|---|---|---|---|
| **NUMBER** | **30** | 10 | **0** | **0** |
| **TEXT** | **3,349** | 150 | **2,242** carried as a presentation field | 2,242 |
| ARRAY | 3 | 3 | 0 | 0 |

### The NUMBER side — 30 uses, and none of them work

| member | uses | in `PINE_TEXT_PREDICATE`? |
|---|---|---|
| `str.length` | 22 | yes (`pine.js:1268`) |
| `str.tonumber` | 5 | **no** |
| `str.pos` | 2 | **no** |
| `str.contains` | 1 | yes (`pine.js:1265`) |

The 23 that the engine *does* hold still do not fold, because of their OPERANDS:

| operand kind across the 30 sites | count |
|---|---|
| a nested CALL (`str.length(str.tostring(…))`, `str.length(arr.get(i).noPrefix())`) | 17 |
| a bare NAME (undecidable from source — `stringValueOf` follows bindings, this census has no binding table, so it is reported and NOT counted either way) | 13 |
| a string LITERAL | 3 |

⛔ **This is where the census caught itself.** Version 3 of the instrument reported **7**
admissible-and-reachable `str.length` uses and then **2** more; all nine were false. Verified
through the door on the exact corpus line:

```
plot(math.pow(10, str.length(str.tostring(syminfo.mintick)) - 2))
  -> ok=false   pine:builtin
     "this Pine built-in names something the engine grammar does not hold — `str.length`"
```

`textOperandOf` (`pine.js:5308`) takes a literal or a `syminfo.*` field and **never** a
nested call, so `parts.every(Boolean)` is false and the call falls through to the namespace
guard. **The "already working because it is admissible in principle" claim is FALSE for every
nested number-yielding use in the corpus.**

⭐ **The absence is evidence because the instrument can see the presence.** The same door,
same session: `plot(close * str.length("abcd"))` → `formula "close * 4"`;
`plot(close * str.length(syminfo.ticker))` → `formula "close * text_length(syminfo('ticker'))"`;
`plot(str.contains(syminfo.ticker, "/") ? high : low)` →
`formula "text_contains(syminfo('ticker'), '/') ? high : low"`. The fold works; the corpus
simply never writes an operand it can take.

### The TEXT side — 2,242 uses, and this one IS working

Verified on the shipped door, not assumed. The object program for
`label.new(bar_index, high, "v " + str.tostring(close))` is, verbatim:

```json
"text": {"v":"text","node":{"t":"cat","args":[{"t":"lit","s":"v "},{"t":"num","tree":1}]}}
trees: [{"type":"series","name":"high"}, {"type":"series","name":"close"}]
```

and for `table.cell(T, 0, 0, str.tostring(close, "#.##") + " px")`:

```json
"text": {"v":"text","node":{"t":"cat","args":[{"t":"num","tree":0,"fmt":"#.##"},{"t":"lit","s":" px"}]}}
```

⭐ **No `str` node anywhere in either.** The NUMBER rides as a tree reference and the surface
formats it, so `str`'s textop-only parentage is never engaged and **no 12th node type is
implied.** Carriage ≠ node type, exactly as the plot `title` and the d2 `message` precedent.

The same shape against a sibling that the reader does NOT know:

```
label.new(bar_index, high, str.format("{0}", close))
  -> unresolvedValues=1, droppedOps=1, dropReasons={"create:label":1}
```

— the whole label is dropped. That is the 36-use `text-slot-unread` row, and it is the
difference between the two halves of this lane.

**Measured across real scripts, not one:** 118 corpus scripts contain a `str.tostring`/`+`
in a `label.new`/`label.set_text`/`table.cell`/`box.set_text` slot. Running every one of them
through the shipped door (1 threw):

| outcome | scripts |
|---|---|
| emit at least one object op **carrying text** built from a nested helper | **30** |
| every text op dropped (`cell:text` / `create:label`) | 38 |
| no object ops at all | 49 |

⛔ **"Carried" is about the TEXT machinery, not about the whole cell.** The named specimen
`4c-nyse-market-breadth-ratio__722410befd.pine` drops all three of its cells with
`cell:text`, `unresolvedValues=3` — because the cell VALUES come from `request.security`,
which refuses `pine:request` twice. That is item (c)'s blocker sitting under (f)'s carriage,
and reading ADM+RCH as "renders today" would credit this lane with a table it does not draw.

---

## THE CONTROL'S OUTPUT, VERBATIM

```
CONTROL: corpus/index.json::counts.committed                  expected 266    got 266    OK
CONTROL: d2 alertcondition calls (alertMessageRides.test.js:10) expected 555    got 555    OK
CONTROL: d2 literal messages, d's own rule                    expected 338    got 338    OK
CONTROL: d2 placeholder messages                              expected 149    got 149    OK
CONTROL: d2 expression messages, d's own rule                 expected 2      got 2      OK
CONTROL: d2 carryable (literal+placeholder)                   expected 487    got 487    OK
CONTROL: non-vacuity: nested text helpers exist at all        expected True   got True   OK
CONTROL: non-vacuity: a depth-2 nesting exists                expected True   got True   OK
CONTROL: non-vacuity: the string-aware rule CAN say expression expected True   got True   OK
CONTROL: non-vacuity: the one-level user-fn resolution fires  expected True   got True   OK
CONTROL: non-vacuity: some form is admissible AND reachable   expected True   got True   OK
CONTROL: non-vacuity: the parent-refuses test fires on the corpus expected True   got True   OK
CONTROL: non-vacuity: the predicate-operand test fires on the corpus expected True   got True   OK
CONTROL: text helpers inside an alertcondition( , ANY depth   expected 0      got 0      OK
CONTROL: text helpers inside a plot-family call, ANY depth    expected 0      got 0      OK
```

`main()` returns 1 if any line reads FAIL. The six numeric controls reproduce
`alertMessageRides.test.js:10`'s committed **487 of 555 — 338 literal + 149 placeholder —
against 2 expressions** and `corpus/index.json::counts.committed`. The last two pin the
measured ZEROS, and they are only evidence because the classifier is asserted at import to
be able to name an `alertcondition` message slot, an `alertcondition` title, a plot title
and a drawing text slot — so a future corpus that writes one moves the line rather than
hiding it. The instrument also carries 28 module-level `assert`s that fail at import: the
stripper both ways, the
substring lookbehind both ways, the nesting scanner's five depths including a grouping
paren, the two message rules against each other, the operand kinds, and six admissibility
blind-spot controls.

---

## DEFECTS FOUND IN THIS INSTRUMENT WHILE BUILDING IT

Every one was found by reading the table the instrument printed, never by reviewing its code.
Each now has a regression control that fails at import if it returns.

1. **A concatenation in a drawing's `text=` was scored NOT CARRIED.** `pine.js:9940` carries
   it. **995 uses** sat on the wrong side of the verdict. Control:
   `admissibility('concat','text','label.*:text','text','label.*:text') == 'shipped-presentation'`,
   with its negative sibling for `str.format`.
2. **Pine's METHOD spelling was invisible.** `tbl.cell(…)`, `.set_text(…)` fell into a
   nameless "other" bucket, 123 uses. They are drawing text slots in Pine and are unseen by
   this engine — two separate facts, and neither is "other". Confirmed at the door:
   `T.cell(0,0,str.tostring(close))` produces the `create` op and **nothing else, with no
   drop reason**.
3. **`alert(` was the single largest "other" outer at 244 uses** and is chart-only; `log.*`,
   `strategy.*` and the collection namespaces were in the same bucket. Four verdicts that
   each name their own guard now.
4. **An `input.*` `tooltip=` was scored "needs a 12th node type"** — 167 uses of invented
   demand. `resolveInput` folds the DEFVAL and never reads a title.
5. **The outermost consumer of a helper handed to a user function is not that function.**
   Resolving one level — the depth `textNodeOf` itself inlines — moved **401 uses** out of
   "reaches nothing" and into the drawing text slots they actually feed.
6. **Typed parameters broke that resolution and could have MISALIGNED it.**
   `dash_cell(table t, int col, int row, string txt, …)` parsed to one parameter, because the
   parameter reader required a bare identifier. Losing them is bad; a partially-matching list
   naming the WRONG slot with total confidence is worse. The last word of a parameter is its
   name, and `method f(…) =>` is a declaration too.
7. **⚰️⚰️ The instrument scored 9 uses ADMISSIBLE AND REACHABLE that the engine refuses.**
   Two separate causes, both "the engine resolves outside-in and my instrument did not":
   *(a)* a foldable node under a parent that throws first (`str.length` inside
   `str.substring`) — 128 uses now say `parent-refuses-first`; *(b)* a predicate whose
   OPERAND is itself a call, which `textOperandOf` cannot take. Both were caught by reading
   the table's own specimen lines and then asking the door, and the door said `ok=false`.
   **This is the defect that would have argued to BUILD something the engine can never
   reach.**
8. **The first version could not finish the corpus.** It re-scanned the whole file for every
   `+` in it. One pass per file now. A census nobody can run is a census nobody checks.

**Not a defect, but recorded because it changes how the table must be read:** USES counts
helper NODES, so `"x " + str.tostring(v)` contributes two. The ARGS column counts distinct
consuming arguments and is the number to use when sizing a demand.

**What was checked and found clean:** the stripper against its own prose in both directions;
the needle against `mystr.tostring(` and `_str.upper(`; the bare `tostring(` spelling against
double-counting `str.tostring(`; grouping parentheses against being counted as nesting depth;
named arguments against being read as expressions (the trap that cost d2 ~155); the
`{{placeholder}}` shape; and `hostAdmissible(table)` — which is **never typed into this
instrument**, because admissibility here is a question about the node type a use would need,
and `parse.js:378`/`parse.js:1555` is the authority on that.
