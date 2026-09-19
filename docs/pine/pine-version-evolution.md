# Lane 5 — Pine Script version evolution (v1 → v6), for renderer + interpreter implementers

Research date: 2026-09-08. All claims below are sourced to tradingview.com pages listed in
[§9 Sources](#9-sources). Anything I could not source is explicitly marked **UNVERIFIED** and must not be
implemented on the strength of this document.

Scope note: this is written to answer one question — *if we implement Pine, which dialect(s) must we accept,
and what did each version change about drawing and execution?* Every row is tagged
**PARSER** (syntax we must accept), **RUNTIME** (semantics we must execute), **RENDERER** (what gets drawn).
Many rows are more than one.

---

## 0. Verdict first

1. **`//@version=` takes a value from 1 to 6, and when the annotation is absent, version 1 is assumed.**
   Sourced verbatim from the Script structure page: *"The version number is a number from 1 to 6."* /
   *"When omitted, version 1 is assumed."* There are **six** legal dialects, not two.
2. **There is no v7.** The release notes run through August 2026 with no v7 announcement; v6 launched
   November 2024 and *"Starting today, future Pine updates will apply exclusively to this version."*
   So v6 is a **moving target**: 19 language/API changes landed *into v6* between Feb 2025 and Aug 2026
   ([Table D](#4-table-d--post-v6-additions-into-the-v6-dialect-2025-2026)).
3. **The renderer is version-dependent, not just the parser.** `color.red`, `color.teal`, `color.yellow`
   changed hex values in v6, and `label.new()`'s default text colour flipped from black to white. The
   *same source text* must paint differently depending on its `//@version=` tag. Any design that
   normalises everything to one IR and then renders version-agnostically is wrong at the pixel level.
4. **Conversion is not mandatory and only exists from v3 up.** Migration-guides overview:
   *"Scripts written in every Pine Script version starting from v3 can be converted to the next version
   automatically using the converter available in the 'Manage Scripts' menu."* v1 and v2 have no
   converter path at all — TradingView runs them as-is.

Full answer to the dialect question in [§8](#8-frank-answer-which-dialects-must-a-renderer-accept).

---

## 1. Version timeline (sourced)

| Version | Released | Source |
|---|---|---|
| v1 | — (implicit default when `//@version=` omitted) | Script structure page |
| v2 | date not given in v3 release notes | v3 release notes: v2 introduced *"Variable assignment (or mutable variables), `if_statement`, `for_statement`"* |
| v3 | **March 20, 2017** | v3 release notes |
| v4 | 2019 (announcement blog "Introducing Pine Script v4!"); drawing objects + `var` in the **June 2019** entry | v4 release notes |
| v5 | **October 2021** — *"Pine Script v5 is here!"* | v5 release notes |
| v6 | **November 2024** — *"Pine Script has graduated to v6! Starting today, future Pine updates will apply exclusively to this version."* Blog "Pine Script® v6 has landed" dated **December 10, 2024**. | release notes / blog |

Note the discrepancy between the November 2024 release-note entry and the December 10, 2024 blog date —
both are reported as sourced; the release note is the authority for the language change, the blog is the
public announcement.

---

## 2. Table A — v1 → v4 (the dialects most published scripts are written in)

Rows #1–#15.

| # | Change | Version | Affects | Notes for us |
|---|---|---|---|---|
| 1 | Mutable variable assignment (`:=`), `if` statement, `for` statement introduced | v2 | PARSER + RUNTIME | v1 has **no** `if`/`for`/reassignment. A v1 parser is expression-only + annotations. |
| 2 | Self-referencing and forward-referencing variables **removed** | v3 | PARSER | v3 release notes: *"Self-referenced and forward-referenced variables are removed"*. v1/v2 scripts legitimately contain them; a v3+ parser must reject them, a v1/v2 parser must support them. This is a real fork in the grammar. |
| 3 | Math operations with booleans **forbidden** | v3 | PARSER + RUNTIME | *"Math operations with booleans are forbidden"*. v1/v2 permitted bool arithmetic. |
| 4 | `security()` no longer returns future data by default; `barmerge.lookahead_off` / `barmerge.lookahead_on` added | v3 | RUNTIME | Same source text, different data, depending on version tag. Lookahead is a correctness-critical runtime switch for us. |
| 5 | Colour constants moved to `color.*` (`red` → `color.red`); `color()` → `color.new()` | v4 | PARSER + RENDERER | v1–v3 use bare `red`, `green`, `blue`… as identifiers. |
| 6 | Constant namespacing: input type constants → `input.*`, plot styles → `plot.style_*`, hline styles → `hline.style_*`, weekdays → `dayofweek.*`, timeframe vars → `timeframe.*` | v4 | PARSER | |
| 7 | `interval` → `timeframe.multiplier`; `ticker`/`tickerid` → `syminfo.ticker`/`syminfo.tickerid`; `n` → `bar_index` | v4 | PARSER | `n` as bar index is a v1–v3 idiom. |
| 8 | Untyped `na` declarations removed — *"In Pine Script v4 it's no longer possible to create variables with an unknown data type at the time of their declaration."* Explicit type keyword required (`float x = na`) | v4 | PARSER + RUNTIME | Type inference rules differ pre/post v4. |
| 9 | `var` keyword — one-time variable initialisation | v4 (June 2019) | PARSER + RUNTIME | Persistent-across-bars storage class. |
| 10 | **Drawing objects arrive**: `label` and `line` — *"Support for drawing objects. Added label and line drawings"* | v4 (June 2019) | PARSER + RENDERER | Before v4 there are **no** drawing objects at all. A v1–v3 renderer needs only plot-family + hline/fill/bgcolor/barcolor. |
| 11 | Arrays: `array.new_float()` and the array function family (later `array.new_line`, `array.new_label`, `array.new_string` in Dec 2020) | v4 (Sept 2020) | PARSER + RUNTIME | **Arrays are a v4 feature, not v5.** |
| 12 | `varip` keyword — persistence across realtime intrabar updates | v4 (March 2021) | PARSER + RUNTIME | **`varip` is v4, not v5.** Semantics: values survive intrabar recalculation rather than being rolled back on each tick. Precise rollback wording not captured verbatim — treat the exact intrabar contract as **UNVERIFIED** and confirm before implementing. |
| 13 | `box` drawing type — *"A new 'box' drawing has been added to Pine, making it super easy to draw rectangles on charts using the Pine syntax."* Blog dated **May 28, 2021**, example carries `//@version=4` | v4 | PARSER + RENDERER | v4 drawings doc: *"Three types of drawings are currently supported: label, line, and boxes."* |
| 14 | `table` drawings and the table function family | v4 (May 2021) | PARSER + RENDERER | Tables are a separate object model (cells, not chart coordinates) — a different renderer path from label/line/box. |
| 15 | Drawing budgets: default ≈50 drawings per script, adjustable via `max_labels_count`, `max_lines_count`, `max_boxes_count` (range 1–500) | v4 | RUNTIME + RENDERER | We need the same eviction rule (oldest-first) or drawings will diverge from TradingView. |

---

## 3. Table B — v4 → v5

Rows #16–#43. The v5 migration guide is the authority; the rename table is reproduced in full in
[Appendix A](#appendix-a--the-full-v4--v5-rename-table-verbatim) because a parser needs every row.

| # | Change | Affects | Notes for us |
|---|---|---|---|
| 16 | `study()` → `indicator()`; parameters `resolution` → `timeframe`, `resolution_gaps` → `timeframe_gaps` | PARSER (+RUNTIME for the param) | Guide: signature otherwise unchanged. **`study()` is the single loudest v≤4 marker.** |
| 17 | `security()` → `request.security()`; `resolution` → `timeframe` | PARSER | |
| 18 | `ta.` namespace — ~65 identifiers moved (`sma`, `ema`, `rsi`, `atr`, `macd`, `bb`, `stoch`, `crossover`, `barsince`, `highest`, `vwap`, `tr`, `accdist`, `obv`, `nvi`, `pvi`, `pvt`, `iii`, `wad`, `wvad`, …) | PARSER | Full list in Appendix A. |
| 19 | `math.` namespace — ~24 identifiers (`abs`, `sin`, `cos`, `tan`, `sqrt`, `log`, `log10`, `pow`, `exp`, `round`, `floor`, `ceil`, `min`, `max`, `avg`, `sum`, `sign`, `random`, `round_to_mintick`, `todegrees`, `toradians`, `acos`, `asin`, `atan`) | PARSER | |
| 20 | `str.` namespace — `tostring()` → `str.tostring()`, `tonumber()` → `str.tonumber()` | PARSER | |
| 21 | `request.` namespace — `financial()`, `quandl()`, `splits()`, `dividends()`, `earnings()`, `security()` | PARSER | |
| 22 | `ticker.` namespace — `heikinashi()`, `kagi()`, `linebreak()`, `pointfigure()`, `renko()`; `tickerid()` → **`ticker.new()`** | PARSER | Note the rename, not just a move. |
| 23 | Single `input()` split into typed constructors: `input.int()`, `input.float()`, `input.bool()`, `input.color()`, `input.string()`, `input.symbol()`, `input.timeframe()`, `input.session()`, `input.source()`, `input.time()` | PARSER + RUNTIME | v4 `input(type=input.integer)` etc. must still be understood for older scripts. |
| 24 | **`iff()` removed** — *"Use the `?:` operator instead"* | PARSER (+RUNTIME) | Runtime nuance: `iff()` was a *function call*, so both branches were always evaluated. If our v≤4 path maps `iff` to a lazy ternary we change behaviour of side-effecting arguments. |
| 25 | **`offset()` removed** — *"Use the `[]` operator instead"* | PARSER | |
| 26 | `transp=` **deprecated and hidden** (not yet removed) | PARSER + RENDERER | Sourced: *"Pine v5 deprecated and hid the `transp` parameter, because it is not fully compatible with the color system that Pine currently uses."* Still accepted in v5 source. |
| 27 | `bgcolor()` and `fill()` implicit default transparency of **90** no longer applied — transparency must be carried in the colour via `color.new()`/`color.rgb()` | RENDERER | Straight alpha-compositing difference between v4 and v5 for identical code. High-value regression test. |
| 28 | Second `rsi()` overload taking a float second argument **removed**; replacement formula `100.0 - (100.0 / (1.0 + arg1 / arg2))` | PARSER + RUNTIME | |
| 29 | Built-in-constant enforcement tightened: params requiring constants reject substitutes (e.g. `barmerge.lookahead_on` instead of `true`; `plot()`/`hline()` style params require `plot.style_*`/`hline.style_*` constants, not integers) | PARSER + RENDERER | Older scripts *do* pass ints/bools here; our v≤4 path must map the integer style codes to styles. |
| 30 | Named-argument renames: `strategy.entry(long)`→`(direction)`, `strategy.order(long)`→`(direction)`, `correlation(source_a, source_b)`→`ta.correlation(source1, source2)`, `nz(x, y)`→`nz(source, replacement)`, `swma(x)`→`ta.swma(source)`, `vwap(x)`→`ta.vwap(source)`, `time(resolution)`→`time(timeframe)`, `time_close(resolution)`→`time_close(timeframe)` | PARSER | Keyword-argument tables must be per-version. |
| 31 | Default session days changed `"23456"` (Mon–Fri) → `"1234567"` (Sun–Sat) in `time()`, `time_close()`, `input.session()` | RUNTIME | Silent behaviour change; affects session-gated plots. |
| 32 | `strategy.exit()` must include at least one effective parameter (`profit`, `limit`, `loss`, `stop`, or a trail parameter) | PARSER + RUNTIME | |
| 33 | New reserved keywords: `catch`, `class`, `do`, `ellipse`, `in`, `is`, `polygon`, `range`, `return`, `struct`, `text`, `throw`, `try` | PARSER | v4 scripts legally use these as identifiers. Note `range` collides with the v4 function `range()` → `ta.range()`. |
| 34 | **`linefill` drawing type added** — *"The space between lines drawn in Pine Script can now be filled! We've added a new `linefill` drawing type"* | PARSER + RENDERER | v5, **December 2021**. Only one linefill can exist between a given pair of lines; a later call replaces the earlier one. |
| 35 | Gradient `fill()` overloads: `fill(plot1, plot2, top_value, bottom_value, top_color, bottom_color)` and `fill(hline1, hline2, top_value, bottom_value, top_color, bottom_color)`; *"all parameters in these new overloads accept series arguments"*; the plots/hlines act as a **mask over the gradient** | PARSER + RENDERER | v5, **October 5, 2022**. This is a genuinely different rasterisation path from flat fill — vertical gradient clipped by the two curves. |
| 36 | **Matrices**: `matrix.new<type>()` + matrix function family | PARSER + RUNTIME | v5. Date reported inconsistently across two fetches of the release notes (**April 2022** in the v5-scoped notes, September 2022 in the aggregate page) — version is v5 either way; treat the month as **UNVERIFIED**. |
| 37 | **User-defined types (UDTs / "objects")** via the `type` keyword — *"Pine objects are instantiations of the new user-defined composite types (UDTs) declared using the `type` keyword"* | PARSER + RUNTIME | v5, December 2022. Introduces reference semantics, fields, `.new()`, `.copy()`. |
| 38 | **Methods** via the `method` keyword — *"specialized functions associated with specific instances of built-in or user-defined types"*; built-in methods exist for `array`, `matrix`, `line`, `linefill`, `label`, `box`, `table` | PARSER + RUNTIME | v5, February 2023. Requires method-call resolution (`id.method()` ≡ `ns.method(id)`). |
| 39 | **Maps**: `map.new<K,V>()` — *"Maps are collections that hold elements in the form of key-value pairs"* | PARSER + RUNTIME | v5, August 2023. |
| 40 | **`chart.point` type** + constructors `chart.point.new()`, `chart.point.from_index()`, `chart.point.from_time()` (`time`, `index`, `price` fields) | PARSER + RUNTIME + RENDERER | v5, September 2023. This is the coordinate abstraction the newer drawing setters consume — it changes the drawing object model, not just adds a helper. |
| 41 | **`polyline` drawing type** — *"Polylines are drawings that sequentially connect the coordinates from an array of up to 10,000 chart points"*; has a `fill_color` parameter | PARSER + RENDERER | v5, October 2023. 10,000-point ceiling is a hard renderer budget. |
| 42 | **Enums** via the `enum` keyword — *"unique data types with all possible values declared by the programmer"*; also drive dropdown inputs | PARSER + RUNTIME | v5, June 2024. |
| 43 | **`force_overlay` parameter** added to drawing/plot functions — *"If true, the drawing will display on the main chart pane"* | PARSER + RENDERER | v5, April/June 2024 (both months cited). This is **pane routing**: a script in a separate pane can emit drawings onto the price pane. Our renderer needs per-drawing pane targeting, not per-script. |

**Correction to the brief:** arrays and `varip` are **v4** features (Table A #11, #12). Matrices, maps, UDTs,
methods, enums, `polyline`, `linefill`, `chart.point` and `force_overlay` are all **v5** features that landed
*during* v5's life, i.e. between Oct 2021 and Nov 2024. None of them are v6 features.

---

## 4. Table C — v5 → v6

Rows #44–#67. Source: the v6 migration guide plus the November 2024 release-note entry and the
December 10, 2024 blog.

| # | Change | Affects | Notes for us |
|---|---|---|---|
| 44 | **`int`/`float` no longer implicitly cast to `bool`** — must wrap: `bool(bar_index) ? color.green : color.red` | PARSER + RUNTIME | Type-checker change. v1–v5 truthiness (non-zero ⇒ true, and in v1/v2 bool arithmetic too) must remain available on the old paths. |
| 45 | **`bool` can no longer be `na`** — strictly `true`/`false`. `na()`, `nz()`, `fixnan()` no longer accept `bool`. Undefined conditions in `if`/`switch` return `false` instead of `na`. History-referencing a bool on the first bar returns `false` instead of `na`. | RUNTIME | This is the deepest v6 runtime change: three-valued logic collapses to two-valued. Same script, different signal on bar 0 and on undefined branches. |
| 46 | Parameters expecting **unique types** (e.g. `plot.style_*`) no longer accept `na`; conditional expressions feeding them must guarantee non-`na`; `switch` needs a `default` block and `if` needs an `else` when returning unique types | PARSER + RUNTIME + RENDERER | Affects style resolution in the renderer. |
| 47 | **Division of two `const int` values preserves the fraction** — `5 / 2` is `2.5`, not `2`; wrap with `int()` for the old result | RUNTIME | Silent numeric divergence between v5 and v6 for identical source. |
| 48 | Variables previously mis-labelled `const` are now correctly parsed as **`series`**, so they can no longer be passed where a `simple` qualifier is required (e.g. `ta.ema()`'s `length` needs `simple int`) | PARSER + RUNTIME | Our qualifier lattice (const → input → simple → series) must be version-aware. |
| 49 | **Colour constants changed value**: `color.red` `#FF5252` → `#F23645`; `color.teal` `#00897B` → `#089981`; `color.yellow` `#FFEB3B` → `#FDD835` | RENDERER | Version-keyed palette table required. |
| 50 | **`label.new()` default text colour** `color.black` → `color.white` | RENDERER | |
| 51 | **`when=` parameter removed** from `strategy.entry()`, `strategy.order()`, `strategy.exit()`, `strategy.close()`, `strategy.close_all()`, `strategy.cancel()`, `strategy.cancel_all()` — replace with an `if` | PARSER | |
| 52 | Strategy default margin changed: `margin_long=0`, `margin_short=0` → **`margin_long=100`, `margin_short=100`** | RUNTIME | Changes position sizing and therefore every equity curve. |
| 53 | Order limit: v5 raised a runtime error above 9000 orders; **v6 trims the oldest orders** and exposes `strategy.closedtrades.first_index` to identify non-trimmed trades | RUNTIME | |
| 54 | `strategy.exit()` now evaluates **both** the relative (`profit`, `loss`, `trail_points`) and absolute (`limit`, `stop`, `trail_price`) parameters and uses whichever price level triggers first (v5 gave absolute priority) | RUNTIME | |
| 55 | **`[]` history operator is invalid on literals and built-in constants** — `6[1]`, `true[10]`, `color.red[3]` all rejected | PARSER | |
| 56 | **UDT field history** cannot be taken directly: `myObject.field[10]` is invalid; use `(myObject[10]).field`, or assign the field to a variable and reference that variable's history | PARSER + RUNTIME | Materially different meaning: history of the *object reference* vs history of the *field value*. |
| 57 | **Dynamic requests on by default** — all `request.*()` functions execute dynamically; the compiler disables it when unnecessary; they can be called **inside loops and conditional blocks** and accept **`series`** arguments for context parameters (symbol, timeframe) | PARSER + RUNTIME | Biggest architectural change for an interpreter: data dependencies are no longer statically enumerable at compile time. Blog: *"Scripts can now use 'series string' values for request.* calls and execute them within loops and local scopes."* |
| 58 | **`timeframe.period` always includes the multiplier** — `"D"`/`"W"`/`"M"` become `"1D"`/`"1W"`/`"1M"` | RUNTIME | Every string comparison in older scripts is version-sensitive. |
| 59 | **Lazy (short-circuit) `and`/`or`** — evaluation stops once the result is determined; functions relying on historical state must be hoisted to global scope to execute every bar | RUNTIME | Consequence: in v6 a `ta.*` call inside the right operand of an `and` may miss bars and produce a *different series* than in v5. This is a semantic trap, not an optimisation. |
| 60 | **`for` loop `to_num` re-evaluated before every iteration** (v5 evaluated once); a mutable boundary expression can extend the loop indefinitely | RUNTIME | Also appears as a dated release-note entry in **March 2025**, i.e. it landed into v6 after launch. |
| 61 | **Repeating the same parameter is now a compilation error** (v5 warned) | PARSER | |
| 62 | **`offset=` requires `simple`** — no longer accepts `series`; must be constant across bars | PARSER + RUNTIME + RENDERER | |
| 63 | **`linewidth` minimum is 1** — `linewidth < 1` is a compilation error | PARSER + RENDERER | Older scripts with `linewidth=0` exist and must still render as v≤5 did. |
| 64 | **`transp=` removed outright** from `bgcolor()`, `fill()`, `plot()`, `plotarrow()`, `plotchar()`, `plotshape()` | PARSER | Deprecated in v5 → removed in v6. |
| 65 | **Negative indices** accepted by `array.get()`, `array.set()`, `array.insert()`, `array.remove()` — `-1` is the last element; bounds checking retained | RUNTIME | |
| 66 | **Text size in typographic points**: *"The `size` property of labels and the `text_size` property of boxes and tables now support 'int' values in addition to the `size.*` constants."* | PARSER + RENDERER | Two coexisting size systems — enum bucket and absolute points. Font metrics must handle both. |
| 67 | **`text_formatting` parameter** on `label.new()`, `box.new()`, `table.cell()` with constants `text.format_bold`, `text.format_italic`, `text.format_none` | PARSER + RENDERER | Bold/italic text rendering, new in v6. |

---

## 5. Table D — post-v6 additions (into the v6 dialect, 2025–2026)

Rows #68–#86. Source: release notes, 2025 and 2026 sections. **No v7, no deprecations or removals
documented in this window, and no new drawing primitives** — only refinements to the existing set.
These matter because "v6" is not one frozen grammar.

| # | Date | Change | Affects |
|---|---|---|---|
| 68 | Feb 2025 | Scope limit removed — *"Scripts can now contain unlimited local scopes from functions, loops, and conditionals."* | PARSER + RUNTIME |
| 69 | Feb 2025 | New `bid` and `ask` variables — real-time market prices on the `"1T"` timeframe | RUNTIME |
| 70 | Mar 2025 | New `box.set_xloc()` — sets left/right box coordinates *and* their reference type | PARSER + RENDERER |
| 71 | Apr 2025 | `ticker.renko()`, `ticker.pointfigure()`, `ticker.kagi()` accept `"PercentageLTP"` box sizing | RUNTIME |
| 72 | May 2025 | `time_close` available for realtime bars on tick and price-based charts via history-referencing | RUNTIME |
| 73 | Jun 2025 | Libraries can export user-defined `const` variables of fundamental types | PARSER + RUNTIME |
| 74 | Jul 2025 | All `input*()` functions gain an `active` parameter controlling whether users can modify the value | PARSER + RENDERER (settings UI) |
| 75 | Jul 2025 | New `syminfo.current_contract` — ticker id of the underlying contract for continuous futures | RUNTIME |
| 76 | Aug 2025 | Max string length raised **4,096 → 40,960** encoded characters | RUNTIME |
| 77 | **Sep 2025** | **`plot()` gains `linestyle`** — solid, dashed, or dotted | PARSER + **RENDERER** |
| 78 | Oct 2025 | `time()` and `time_close()` gain `timeframe_bars_back` — timestamps by bar offset on another timeframe | PARSER + RUNTIME |
| 79 | Nov 2025 | New `syminfo.isin` — 12-character ISIN | RUNTIME |
| 80 | Dec 2025 | Line-wrapping rules relaxed — wrapped lines inside parentheses may be indented by **any** number of spaces, including multiples of four | **PARSER** (whitespace/continuation grammar) |
| 81 | Jan 2026 | `request.footprint()` plus `footprint` and `volume_row` data types (Premium/Ultimate plans only) | PARSER + RUNTIME |
| 82 | Apr 2026 | **Multiline string literals** — triple quotes `"""…"""` spanning lines, newlines inserted automatically between lines | **PARSER** (lexer) |
| 83 | Apr 2026 | `array.sort()`, `array.sort_indices()`, `matrix.sort()` gain `sort_field` for UDT collections | PARSER + RUNTIME |
| 84 | Jul 2026 | Strategies gain `calc_on_every_history_tick` — *"the script executes once for each available tick in every historical bar"* | RUNTIME |
| 85 | Aug 2026 | **New `once` conditional structure** — a block that executes once when a condition first becomes true, then never again | **PARSER** + RUNTIME |
| 86 | Aug 2026 | `array.binary_search()` family gains `sort_field` for UDT collections | PARSER + RUNTIME |

**Total change-table rows: 86** (Table A 15, Table B 28, Table C 24, Table D 19).

---

## 6. Deprecation and removal lists

### 6a. Removed outright — CANNOT appear in a valid v6 script, WILL appear in older published scripts

Grouped by the version that removed them. Every item here is a positive signal that a script is pre-v6,
and our older-dialect paths must implement all of them.

**Removed at v3** (so present only in v1/v2 sources)
- Self-referencing variables
- Forward-referencing variables
- Math operations on booleans

**Removed at v4** (present in v1–v3 sources)
- Untyped `na`-initialised variable declarations (declaration without a known type)
- Bare colour identifiers (`red`, `green`, …) — became `color.*`
- `color()` — became `color.new()`
- `interval` — became `timeframe.multiplier`
- `ticker` / `tickerid` as globals — became `syminfo.ticker` / `syminfo.tickerid`
- `n` — became `bar_index`

**Removed at v5** (present in v1–v4 sources)
- `study()` — became `indicator()`
- `security()` — became `request.security()`
- `tickerid()` — became `ticker.new()`
- **`iff()`** — no replacement function; use `?:`
- **`offset()`** — no replacement function; use `[]`
- Every un-namespaced TA builtin (`sma`, `ema`, `rsi`, `atr`, `macd`, `bb`, `bbw`, `cci`, `cmo`, `cog`, `dmi`, `hma`, `kc`, `kcw`, `linreg`, `mfi`, `mom`, `rma`, `roc`, `sar`, `stoch`, `supertrend`, `swma`, `tsi`, `vwma`, `wma`, `wpr`, `alma`, `barsince`, `change`, `correlation`, `cross`, `crossover`, `crossunder`, `cum`, `dev`, `falling`, `highest`, `highestbars`, `lowest`, `lowestbars`, `median`, `mode`, `percentile_linear_interpolation`, `percentile_nearest_rank`, `percentrank`, `pivothigh`, `pivotlow`, `range`, `rising`, `stdev`, `valuewhen`, `variance`) and the un-namespaced TA variables (`accdist`, `iii`, `nvi`, `obv`, `pvi`, `pvt`, `tr`, `vwap`, `wad`, `wvad`)
- Every un-namespaced math builtin (`abs`, `acos`, `asin`, `atan`, `avg`, `ceil`, `cos`, `exp`, `floor`, `log`, `log10`, `max`, `min`, `pow`, `random`, `round`, `round_to_mintick`, `sign`, `sin`, `sqrt`, `sum`, `tan`, `todegrees`, `toradians`)
- `tostring()`, `tonumber()` — became `str.*`
- `financial()`, `quandl()`, `splits()`, `dividends()`, `earnings()` — became `request.*`
- `heikinashi()`, `kagi()`, `linebreak()`, `pointfigure()`, `renko()` — became `ticker.*`
- The `input.bool` / `input.color` / `input.float` / `input.integer` / `input.resolution` / `input.session` / `input.source` / `input.string` / `input.symbol` / `input.time` **type constants** — replaced by same-named `input.*()` *functions* (`input.integer` → `input.int()`, `input.resolution` → `input.timeframe()`)
- The `rsi()` overload taking a float second argument
- Argument names `long` (strategy.entry/order), `resolution` / `resolution_gaps`, `source_a`/`source_b`, `x`/`y` on `nz`/`swma`/`vwap`
- Integer/boolean substitutes where a built-in constant is now required (`true` for `barmerge.lookahead_on`; integer style codes for `plot.style_*` / `hline.style_*`)

**Removed at v6** (present in v1–v5 sources)
- **`transp=`** on `bgcolor()`, `fill()`, `plot()`, `plotarrow()`, `plotchar()`, `plotshape()`
- **`when=`** on `strategy.entry()`, `strategy.order()`, `strategy.exit()`, `strategy.close()`, `strategy.close_all()`, `strategy.cancel()`, `strategy.cancel_all()`
- Implicit `int`/`float` → `bool` coercion
- `na` as a `bool` value; `bool` arguments to `na()`, `nz()`, `fixnan()`
- `na` for parameters of unique types (e.g. `plot.style_*`)
- `[]` applied to literals or built-in constants
- Direct history-referencing of a UDT field (`obj.field[n]`)
- Repeated named parameters in one call
- `series`-qualified `offset=`
- `linewidth` values below 1

### 6b. Deprecated / discouraged but still compiles

| Item | Status | Source strength |
|---|---|---|
| `transp=` in a **v5** script | *"Pine v5 deprecated and hid the `transp` parameter"* — hidden from docs, still accepted by the v5 compiler; removed only at v6 | Sourced |
| `//@version=1` … `//@version=5` scripts generally | Still valid input: the version annotation legally takes 1–6, and conversion is offered, not enforced (*"can be converted … automatically using the converter"*) | Sourced |
| Omitting `//@version=` entirely | Legal; *"version 1 is assumed"*; docs add *"It is strongly recommended to always use the latest version of the language."* | Sourced |
| `size.*` constants for label/box/table text in v6 | Still accepted — int points were added *"in addition to"* them | Sourced |
| Non-dynamic `request.*()` usage in v6 | Still fine; *"The compiler automatically disables [dynamic requests] when unnecessary"* | Sourced |
| `request.quandl()` | I did **not** find a sourced statement on its current status (Quandl/Nasdaq Data Link was retired as a vendor). **UNVERIFIED** — do not assume either way. | Unverified |
| A general v6 "compiles-with-warning" list | Beyond the rows above, the docs I read publish **no** consolidated deprecation list for v6. **UNVERIFIED** — assume the migration guide's error list is the whole story until proven otherwise. | Unverified |

---

## 7. Drawing primitive → first available version

| Primitive | First Pine version | First appeared | Sourced note |
|---|---|---|---|
| **`label`** | **v4** | June 2019 | v4 release notes: *"Support for drawing objects. Added label and line drawings"* |
| **`line`** | **v4** | June 2019 | same entry |
| **`box`** | **v4** | May 28, 2021 | Blog *"New drawing — Box"*, example carries `//@version=4`; v4 drawings doc: *"Three types of drawings are currently supported: label, line, and boxes."* |
| **`table`** | **v4** | May 2021 | v4 release notes: *"Added support for table drawings and functions for working with them"* |
| **`linefill`** | **v5** | December 2021 | v5 release notes: *"We've added a new `linefill` drawing type"* |
| **`chart.point`** | **v5** | September 2023 | v5 release notes: `chart.point.new()` *"Creates a new chart.point object with the specified `time`, `index`, and `price`"*. Not a drawing itself — the coordinate type the newer drawing APIs consume. |
| **`polyline`** | **v5** | October 2023 | v5 release notes: *"Polylines are drawings that sequentially connect the coordinates from an array of up to 10,000 chart points"* |

Two consequences:
- **v1–v3 have no drawing objects whatsoever.** A v1–v3 renderer needs only the plot family
  (`plot`, `plotshape`, `plotchar`, `plotarrow`, `plotcandle`, `plotbar`), `hline`, `fill`, `bgcolor`,
  `barcolor`. That is a much smaller renderer.
- **v6 introduced no new drawing primitive.** It changed *properties* of the existing ones
  (int text sizes, `text_formatting`, `linewidth ≥ 1`, new colour constant values, white default label text)
  and post-launch added `box.set_xloc()` and `plot(linestyle=)`.

---

## 8. Frank answer: which dialects must a renderer accept

**All six: v1, v2, v3, v4, v5, v6 — and the absent-annotation case, which is v1.**

The reasoning, in order of how load-bearing it is:

1. **The compiler itself accepts 1–6.** *"The version number is a number from 1 to 6."* TradingView has
   never dropped a version. There is no sunset notice anywhere in the release notes through August 2026.
   A published script tagged `//@version=2` still compiles, still runs, still serves data to whoever loads
   the chart. If we reject it, we are not "not supporting a legacy dialect" — we are failing to render a
   script TradingView renders today.
2. **Omission defaults to v1, silently.** *"When omitted, version 1 is assumed."* Old community scripts
   frequently have no annotation at all. A renderer that assumes "no tag ⇒ latest" will mis-execute them
   with the *strictest* semantics — bool-strictness, fractional const division, lazy `and`/`or` — and
   produce plausible-looking wrong output. This is the single most dangerous default we could pick.
3. **The auto-converter starts at v3.** *"Scripts written in every Pine Script version starting from v3 can
   be converted to the next version automatically."* So v1/v2 scripts have no supported upgrade path at
   all, which is precisely why they persist unconverted in the published ecosystem. There is no world in
   which the long tail migrates.
4. **The pre-v5 dialect is not a subset — it is a different language in three places.** (a) v1/v2 allow
   self-referencing and forward-referencing variables that v3 *removed*, and bool arithmetic that v3
   *forbade*; a v6-shaped parser cannot parse them at all. (b) v1–v3 have no drawing objects, so scripts
   express the same visual intent through the plot family and `fill`/`bgcolor` instead. (c) every builtin is
   un-namespaced, and `study()` — not `indicator()` — declares the script. Our symbol table must be
   version-keyed, not merged, because names collide across versions (`range()` is a v4 TA function and a
   v5 reserved keyword).
5. **The renderer cannot be version-agnostic either.** This is the part that is easy to under-plan.
   Identical source text must paint differently by version: `color.red` is `#FF5252` in v5 and `#F23645`
   in v6; `color.teal` and `color.yellow` likewise; `label.new()` defaults to black text in v5 and white in
   v6; `bgcolor()`/`fill()` applied an implicit transparency of 90 in v4 and stopped in v5;
   `linewidth=0` is legal pre-v6 and an error in v6; text size is an enum bucket pre-v6 and may be
   absolute typographic points in v6. Any one of these produces a visual diff that a user will read as
   "your renderer is broken."
6. **The runtime forks are worse than the syntax forks, and they are silent.** v6 turned bool into
   two-valued logic (undefined `if`/`switch` returns `false`, not `na`; bool history on bar 0 is `false`,
   not `na`), made `const int` division fractional, made `and`/`or` short-circuit — which can starve a
   `ta.*` call of the every-bar execution its internal state requires — re-evaluates `for` bounds every
   iteration, and changed `timeframe.period` from `"D"` to `"1D"`. v3 flipped `security()` lookahead
   default. v5 changed default session days from Mon–Fri to Sun–Sat. None of these throw. All of them
   change numbers on the chart.

**Practical recommendation — four accepted dialect groups, one version-keyed pipeline:**

| Group | Versions | Parser burden | Runtime burden | Renderer burden |
|---|---|---|---|---|
| **A** | v1–v3 | Highest oddity: self/forward refs (v1–v2), bool arithmetic (v1–v2), un-namespaced everything, bare colour identifiers, `n`, `interval`, no `var`, no `if`/`for` in v1 | Lookahead default differs at v3 | **Lowest** — plot family + `hline`/`fill`/`bgcolor`/`barcolor`, no drawing objects |
| **B** | v4 | `study()`, un-namespaced functions but namespaced *constants*, untyped-`na` gone, `iff`/`offset` present, `transp` live | `var`, `varip`, arrays; implicit transparency 90 on `bgcolor`/`fill` | label, line, box, table + `max_*_count` budgets |
| **C** | v5 | Full namespacing, `input.*()`, 13 new reserved words, UDTs/methods/enums, generics (`matrix.new<T>`, `map.new<K,V>`) | Matrices, maps, objects, three-valued bool, int division truncates, eager `and`/`or` | + linefill, polyline (≤10k points), chart.point, gradient `fill`, `force_overlay` pane routing |
| **D** | v6 (a moving target) | + `bool()` casts, no `[]` on literals, `(obj[n]).field`, no dup args, `simple` `offset`, `once` (2026), `"""…"""` (2026), relaxed continuation indent (2025) | + two-valued bool, fractional const division, lazy `and`/`or`, dynamic `request.*` (loops, conditionals, series contexts), per-iteration `for` bounds, `"1D"` period strings, negative array indices | + new colour hexes, white default label text, `linewidth ≥ 1`, int text sizes, `text_formatting`, `plot(linestyle=)`, `box.set_xloc()` |

Group A is cheap on the renderer and expensive on the parser; Group D is the reverse. If we must stage the
work, the highest coverage per unit effort is **B + C first** (they share the drawing object model and cover
the bulk of the drawing-heavy published corpus), then **D** (current authoring target, and the only one
receiving new features), then **A** (large in count, small in feature surface — a v1–v3 script can only
plot, fill, and colour bars).

What we must not do is normalise all six into one IR and render it once. The version tag has to survive all
the way to the paint call.

---

## 9. Sources

- Migration guide, to v6 — https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/
- Migration guide, to v5 (rename tables) — https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-5/
- Migration guide, to v4 — https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-4/
- Migration guides overview (converter scope) — https://www.tradingview.com/pine-script-docs/migration-guides/overview/
- Release notes (current; 2024–2026 entries) — https://www.tradingview.com/pine-script-docs/release-notes/
- Release notes, v5-scoped — https://www.tradingview.com/pine-script-docs/v5/release-notes/
- Release notes, v4-scoped — https://www.tradingview.com/pine-script-docs/v4/release-notes/
- Release notes, v3-scoped (v2/v3 history) — https://www.tradingview.com/pine-script-docs/v3/release-notes/
- Script structure (`//@version=` rule) — https://www.tradingview.com/pine-script-docs/language/script-structure/
- v4 drawings doc (drawing types, limits, setter lists) — https://www.tradingview.com/pine-script-docs/v4/essential/drawings/
- Visuals / Fills (fill and linefill signatures) — https://www.tradingview.com/pine-script-docs/visuals/fills/
- Blog, "Pine Script® v6 has landed" (Dec 10, 2024) — https://www.tradingview.com/blog/en/pine-script-v6-has-landed-48830/
- Blog, "New drawing — Box" (May 28, 2021) — https://www.tradingview.com/blog/en/new-drawing-box-24667/
- Blog, "Pine Script™ now does vertical gradients!" — https://www.tradingview.com/blog/en/pine-script-vertical-gradients-33586/

### UNVERIFIED items — do not implement on this document alone

1. **"plot() callable in local scopes in v6."** One fetch of the release-notes page surfaced a
   "Plot in Local Scopes — November 2024 (v6)" line item; a targeted re-fetch of the *same page* asking
   specifically for it reported it is **not mentioned**. Likely a summarisation artifact. Treat as false
   until confirmed against the reference manual. (The Feb 2025 "unlimited local scopes" entry is a
   *different*, verified change and does not imply this.)
2. **Matrices release month** — April 2022 vs September 2022, conflicting across two fetches of the docs.
   Version (v5) is not in doubt.
3. **`linefill` release month** — December 2021 (v5-scoped release notes, with a direct introduction quote)
   vs February 2023 (aggregate page, in a passage about *methods* listing linefill among supported types).
   December 2021 is the better-evidenced introduction date. Version (v5) is not in doubt.
4. **`force_overlay` release month** — cited as both April 2024 and June 2024. Version (v5) is not in doubt.
5. **Exact `varip` intrabar contract** — that values persist across realtime ticks is sourced; the precise
   rollback/reset rules were not captured verbatim. Confirm from the reference manual before implementing.
6. **`request.quandl()` current status** in v6 — no sourced statement found.
7. **Pine v2 release date** — not given in the v3 release notes.
8. **Precise `ta.`/`math.` identifier counts** ("~65", "~24") are counts of the rows reproduced in
   Appendix A, which is itself a transcription of the migration guide's tables. Verify against the v5
   reference manual before using as a completeness check.
9. **Reference manuals were not machine-readable.** `https://www.tradingview.com/pine-script-reference/v3|v4/`
   render their identifier index via JavaScript, so WebFetch returned only page chrome. Every
   presence/absence claim in this document therefore rests on prose docs, migration guides, release notes
   and blogs — not on the reference index. A browser-driven pass over the four reference manuals (v3, v4,
   v5, v6) is the obvious next step and would give us an authoritative per-version identifier set.

---

## Appendix A — the full v4 → v5 rename table (verbatim)

Transcribed from the v5 migration guide. This is the parser's remapping table for Group B → Group C.

### Removed functions and variables

| v4 | v5 |
|---|---|
| `input.bool` input | Replaced by `input.bool()` |
| `input.color` input | Replaced by `input.color()` |
| `input.float` input | Replaced by `input.float()` |
| `input.integer` input | Replaced by `input.int()` |
| `input.resolution` input | Replaced by `input.timeframe()` |
| `input.session` input | Replaced by `input.session()` |
| `input.source` input | Replaced by `input.source()` |
| `input.string` input | Replaced by `input.string()` |
| `input.symbol` input | Replaced by `input.symbol()` |
| `input.time` input | Replaced by `input.time()` |
| `iff()` | Use the `?:` operator instead |
| `offset()` | Use the `[]` operator instead |

### Renamed functions and parameters (no namespace change)

| v4 | v5 |
|---|---|
| `study(<...>, resolution, resolution_gaps, <...>)` | `indicator(<...>, timeframe, timeframe_gaps, <...>)` |
| `strategy.entry(long)` | `strategy.entry(direction)` |
| `strategy.order(long)` | `strategy.order(direction)` |
| `time(resolution)` | `time(timeframe)` |
| `time_close(resolution)` | `time_close(timeframe)` |
| `nz(x, y)` | `nz(source, replacement)` |

### `ta` namespace — technical analysis

| v4 | v5 |
|---|---|
| `accdist` | `ta.accdist` |
| `alma()` | `ta.alma()` |
| `atr()` | `ta.atr()` |
| `bb()` | `ta.bb()` |
| `bbw()` | `ta.bbw()` |
| `cci()` | `ta.cci()` |
| `cmo()` | `ta.cmo()` |
| `cog()` | `ta.cog()` |
| `dmi()` | `ta.dmi()` |
| `ema()` | `ta.ema()` |
| `hma()` | `ta.hma()` |
| `iii` | `ta.iii` |
| `kc()` | `ta.kc()` |
| `kcw()` | `ta.kcw()` |
| `linreg()` | `ta.linreg()` |
| `macd()` | `ta.macd()` |
| `mfi()` | `ta.mfi()` |
| `mom()` | `ta.mom()` |
| `nvi` | `ta.nvi` |
| `obv` | `ta.obv` |
| `pvi` | `ta.pvi` |
| `pvt` | `ta.pvt` |
| `rma()` | `ta.rma()` |
| `roc()` | `ta.roc()` |
| `rsi(x, y)` | `ta.rsi(source, length)` |
| `sar()` | `ta.sar()` |
| `sma()` | `ta.sma()` |
| `stoch()` | `ta.stoch()` |
| `supertrend()` | `ta.supertrend()` |
| `swma(x)` | `ta.swma(source)` |
| `tr` | `ta.tr` |
| `tr()` | `ta.tr()` |
| `tsi()` | `ta.tsi()` |
| `vwap` | `ta.vwap` |
| `vwap(x)` | `ta.vwap(source)` |
| `vwma()` | `ta.vwma()` |
| `wad` | `ta.wad` |
| `wma()` | `ta.wma()` |
| `wpr()` | `ta.wpr()` |
| `wvad` | `ta.wvad` |

### `ta` namespace — supporting functions

| v4 | v5 |
|---|---|
| `barsince()` | `ta.barsince()` |
| `change()` | `ta.change()` |
| `correlation(source_a, source_b, length)` | `ta.correlation(source1, source2, length)` |
| `cross(x, y)` | `ta.cross(source1, source2)` |
| `crossover(x, y)` | `ta.crossover(source1, source2)` |
| `crossunder(x, y)` | `ta.crossunder(source1, source2)` |
| `cum(x)` | `ta.cum(source)` |
| `dev()` | `ta.dev()` |
| `falling()` | `ta.falling()` |
| `highest()` | `ta.highest()` |
| `highestbars()` | `ta.highestbars()` |
| `lowest()` | `ta.lowest()` |
| `lowestbars()` | `ta.lowestbars()` |
| `median()` | `ta.median()` |
| `mode()` | `ta.mode()` |
| `percentile_linear_interpolation()` | `ta.percentile_linear_interpolation()` |
| `percentile_nearest_rank()` | `ta.percentile_nearest_rank()` |
| `percentrank()` | `ta.percentrank()` |
| `pivothigh()` | `ta.pivothigh()` |
| `pivotlow()` | `ta.pivotlow()` |
| `range()` | `ta.range()` |
| `rising()` | `ta.rising()` |
| `stdev()` | `ta.stdev()` |
| `valuewhen()` | `ta.valuewhen()` |
| `variance()` | `ta.variance()` |

### `math` namespace

| v4 | v5 |
|---|---|
| `abs(x)` | `math.abs(number)` |
| `acos(x)` | `math.acos(number)` |
| `asin(x)` | `math.asin(number)` |
| `atan(x)` | `math.atan(number)` |
| `avg()` | `math.avg()` |
| `ceil(x)` | `math.ceil(number)` |
| `cos(x)` | `math.cos(angle)` |
| `exp(x)` | `math.exp(number)` |
| `floor(x)` | `math.floor(number)` |
| `log(x)` | `math.log(number)` |
| `log10(x)` | `math.log10(number)` |
| `max()` | `math.max()` |
| `min()` | `math.min()` |
| `pow()` | `math.pow()` |
| `random()` | `math.random()` |
| `round(x, precision)` | `math.round(number, precision)` |
| `round_to_mintick(x)` | `math.round_to_mintick(number)` |
| `sign(x)` | `math.sign(number)` |
| `sin(x)` | `math.sin(angle)` |
| `sqrt(x)` | `math.sqrt(number)` |
| `sum()` | `math.sum()` |
| `tan(x)` | `math.tan(angle)` |
| `todegrees()` | `math.todegrees()` |
| `toradians()` | `math.toradians()` |

### `request` namespace

| v4 | v5 |
|---|---|
| `financial()` | `request.financial()` |
| `quandl()` | `request.quandl()` |
| `security(<...>, resolution, <...>)` | `request.security(<...>, timeframe, <...>)` |
| `splits()` | `request.splits()` |
| `dividends()` | `request.dividends()` |
| `earnings()` | `request.earnings()` |

### `ticker` namespace

| v4 | v5 |
|---|---|
| `heikinashi()` | `ticker.heikinashi()` |
| `kagi()` | `ticker.kagi()` |
| `linebreak()` | `ticker.linebreak()` |
| `pointfigure()` | `ticker.pointfigure()` |
| `renko()` | `ticker.renko()` |
| `tickerid()` | `ticker.new()` |

### `str` namespace

| v4 | v5 |
|---|---|
| `tostring(x, y)` | `str.tostring(value, format)` |
| `tonumber(x)` | `str.tonumber(string)` |

### v5 reserved keywords (illegal as identifiers from v5 on)

`catch`, `class`, `do`, `ellipse`, `in`, `is`, `polygon`, `range`, `return`, `struct`, `text`, `throw`, `try`
