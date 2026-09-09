# Lane 5 — TradingView's Built-in Indicator Library + Adoption of New Pine Features

**Authority:** READ_ONLY_RESEARCH. No files in `uct-dashboard` touched, no git mutations, no `.py` in `scratchpad/acq` run or modified (`acq/*.json` read only).
**Date of collection:** 2026-09-08. All network reads done live on that date.
**Evidence discipline:** every claim below is tagged `[DOC]` (verbatim in TradingView docs / release notes / blog), `[OBS]` (I fetched and counted it myself in this session — reproducible from the artifacts listed at the end), or `[INFER]` / `UNVERIFIED` (my reasoning, not a source).

---

## PART 1 — TradingView's built-in indicator library

### 1.1 What the endpoint returns

`https://pine-facade.tradingview.com/pine-facade/list/?filter=standard` → JSON array, **145 entries** `[OBS]`, all owned by `userId: 605017` (TradingView's own account) `[OBS]`.

Per-entry fields (union across all 145) `[OBS]`:
`userId`, `scriptName`, `scriptSource` (**always empty string in the list response — 0/145 carry source**), `scriptAccess`, `scriptIdPart`, `version`, `lastVersionMaj` (always `"0.0"`), `extra`.
`extra` keys (union): `isAuto`, `isBeta`, `isBuiltIn`, `isChartPattern`, `isCompiled`, `isMTFResolution`, `isNew`, `isPineEditorNewTemplate`, `isUpdated`, `is_price_study`, `kind`, `shortDescription`, `sourceInputsCount`, `stats`, `tags`.

**Important field semantics, verified not assumed:**

| Field | What it actually is | Evidence |
|---|---|---|
| `version` | **script revision counter**, not the Pine language version. Values `3.0`…`46.0`. `STD;RSI` is `46.0`, `STD;Supertrend` is `11.0`. | `[OBS]` — the fetched source of `STD;RSI` carries `//@version=6` while the list says `46.0` |
| `is_price_study` | overlay (`true`) vs separate pane (`false`) | `[OBS]` — matches `overlay = true` in source for 142/145 minus 3 explainable cases (below) |
| `sourceInputsCount` | number of `input(...)`-declared **source/series** inputs (0–4) | `[OBS]` — `STD;MA%Ribbon` = 4, and its source has 4 source inputs |
| `stats` | call counts for **only five** primitives: `plot`, `plotshape`, `plotchar`, `plotcandle`, `alertcondition`. Nothing else is counted. | `[OBS]` — see 1.5 |
| `tags` | empty array for all 145 | `[OBS]` |

Composition `[OBS]`:

| Split | Count |
|---|---|
| `kind = study` | 121 |
| `kind = strategy` | 23 |
| `kind = library` | 1 (`PUB;LIB_TradingView_RelativeValue`) |
| overlay (`is_price_study=true`) | 69 |
| separate pane | 76 |
| `isMTFResolution = true` | 87 |
| `isAuto = true` | 5 (Auto Fib Extension, Auto Fib Retracement, Auto Key Levels, Auto Pitchfork, Auto Trend Detector) |
| `isBeta = true` | 2 (Auto Key Levels, Auto Trend Detector) |
| `isChartPattern = true` | 1 (Auto Trend Detector) |
| `isNew = true` | 1 (Auto Trend Detector) |

Note the one non-`STD;` id: the single library is `PUB;LIB_TradingView_RelativeValue`, i.e. TradingView ships one *published library* inside the "standard" list.

### 1.2 How many built-in sources are actually retrievable — measured, not assumed

`scriptAccess` in the list `[OBS]`:

- `open_no_auth` — **142**
- `closed_no_auth` — **3**: `STD;Auto_Key_Levels`, `STD;Auto_Trend_Detector`, `PUB;LIB_TradingView_RelativeValue`

I then **fetched all 145** from `https://pine-facade.tradingview.com/pine-facade/get/<urlencoded scriptIdPart>/last` `[OBS]`:

- **142 returned full Pine source** (HTTP 200, `source` field populated).
- **3 returned HTTP 401 Unauthorized** — exactly the three `closed_no_auth` entries.

So: **142 of 145 built-in sources are retrievable anonymously; 3 are not, and `scriptAccess` predicts it exactly.** The three unavailable ones are the two beta "Auto" pattern detectors and the RelativeValue library.

**URL-encoding gotcha (cost me 7 failed fetches first pass):** `scriptIdPart` values contain literal `%` characters used as TradingView's own separator (`STD;Ichimoku%1Cloud`, `STD;MA%Ribbon`). You must percent-encode the `%` itself (`%25`) as well as the `;` (`%3B`) — i.e. `urllib.parse.quote(sid, safe='')`. Passing `STD%3BIchimoku%1Cloud` returns **HTTP 400**; `STD%3BIchimoku%251Cloud` returns 200. `[OBS]`

### 1.3 Aggregate — what the `stats` object says TradingView draws

Across all **145** built-ins `[OBS]`:

| `stats` primitive | # built-ins using it | % of 145 | total calls |
|---|---|---|---|
| `plot` | 107 | 73.8% | 234 |
| `alertcondition` | 8 | 5.5% | 22 |
| `plotshape` | 4 | 2.8% | 10 |
| `plotcandle` | 4 | 2.8% | 5 |
| `plotchar` | 2 | 1.4% | 5 |
| `plotbar` | **0** | 0% | 0 |
| `plotarrow` | **0** | 0% | 0 |

**Distribution of `stats.plot` counts** `[OBS]`:

| plots | # built-ins | note |
|---|---|---|
| 0 | 38 | 21 of these are strategies; the rest draw only with lines/boxes/labels/tables or via an imported library |
| 1 | 54 | the modal built-in is a **single-plot** oscillator or MA |
| 2 | 21 | |
| 3 | 17 | |
| 4 | 10 | |
| 5 | 1 | RSI Divergence Indicator |
| 7 | 3 | Ichimoku Cloud, RSI, VWAP |
| 21 | 1 | Auto Key Levels (source closed) |

**Baseline number to quote: the median built-in draws 1 plot; 92 of 145 (63%) draw 0 or 1 plot; only 5 of 145 draw more than 4.** Total plot calls across TradingView's entire shipped library = **234**. `[OBS]`

### 1.4 The `stats` object is an incomplete census — do not use it as "what TradingView draws"

`stats` counts five primitives and **silently omits every other presentation primitive**. Verified: `STD;RSI` has `stats: {plot:7, plotshape:2, alertcondition:2}` but its source also contains **4 `fill()` and 3 `hline()`** calls. `STD;Zig_Zag` has `stats: {}` — an empty object — yet it draws a full zigzag, because it `import TradingView/ZigZag/9` and the drawing happens inside the library. `[OBS]`

So I ran my own regex census over the **142 retrievable sources** (string literals and `//` comments stripped first, to avoid counting words inside text):

| primitive / feature | # of 142 built-ins | % | total occurrences |
|---|---|---|---|
| `plot()` | 105 | 74% | 210 |
| `hline()` | **42** | **30%** | 87 |
| `fill()` | **28** | **20%** | 42 |
| `alertcondition()` | 8 | 6% | 22 |
| `plotshape()` | 4 | 3% | 10 |
| `plotcandle()` | 4 | 3% | 5 |
| `plotchar()` | 2 | 1% | 5 |
| `bgcolor()` | 2 | 1% | 2 |
| `barcolor()` | **0** | 0% | 0 |
| `plotbar()` / `plotarrow()` | **0** | 0% | 0 |
| `line.new` | 7 | 5% | 17 |
| `label.new` | 7 | 5% | 8 |
| `linefill.new` | 6 | 4% | 9 |
| `table.new` | 5 | 4% | 5 |
| `box.new` | 4 | 3% | 8 |
| `polyline.new` | **0** | **0%** | 0 |
| `chart.point.*` | 2 | 1% | 30 |
| `alert()` | 2 | 1% | 2 |
| `array.*` | 9 | 6% | 49 |
| `matrix.*` | 2 | 1% | 2 |
| `map.*` | **0** | 0% | 0 |
| `type` (UDT declaration) | 4 | 3% | 7 |
| `method` declaration | 6 | 4% | 15 |
| `enum` declaration | 1 | <1% | 1 |
| `import` (library) | **19** | **13%** | 19 |
| `force_overlay` | 1 | <1% | 1 |
| `varip` | **0** | 0% | 0 |
| `log.*` | **0** | 0% | 0 |
| `request.*` | 14 | 10% | 26 |
| `request.security_lower_tf` | 0 | 0% | 0 |
| `switch` | 25 | 18% | 36 |
| `for` | 11 | 8% | 32 |
| `while` | 1 | <1% | 1 |
| `display.*` argument | 41 | 29% | 409 |
| `input.*` | 130 | 92% | 699 |
| `active =` (input gating) | **23** | **16%** | 205 |
| `color.from_gradient` | 3 | 2% | 5 |
| `runtime.error` | 26 | 18% | 29 |
| `timeframe =` in declaration | 89 | 63% | 90 |
| `text_font_family` | 0 | 0% | 0 |
| `export` | 0 | 0% | 0 (the one library is closed-source) |

Sanity check on the method: summing `stats.plot` over just the 142 retrievable = 210, and my counted `plot()` = **210, exact match**, per-script with zero disagreements. The 234−210=24 difference is the 3 closed scripts (Auto Key Levels 21 + RelativeValue 3). `[OBS]`

**Pine language version of TradingView's own library:** of the 142, **141 carry `//@version=6`**; exactly one has **no version pragma at all** — `STD;Rob%1Booker%1ADX%1Breakout%1Strategy`, which begins directly with `strategy("Rob Booker - ADX Breakout", ...)` and therefore compiles as Pine v1/v2 legacy. `[OBS]` TradingView has migrated essentially its entire shipped library to v6.

### 1.5 Two more things TradingView's own library reveals

**(a) TradingView's built-ins import libraries — including a community one.** 19 of 142 built-ins have an `import` line `[OBS]`:

| imported library | # built-ins importing it |
|---|---|
| `TradingView/ta/11` | 6 |
| `TradingView/ZigZag/7` | 3 |
| `TradingView/ta/12` | 2 |
| `TradingView/ta/8` | 2 |
| `TradingView/TechnicalRating/3` | 2 |
| `TradingView/ZigZag/9` | 1 |
| `TradingView/ValueAtTime/2` | 1 |
| `TradingView/ta/7` | 1 |
| **`PineCoders/getSeries/1`** | 1 |

Four different pinned versions of `TradingView/ta` are live simultaneously (7, 8, 11, 12) — library version pinning means TradingView never bulk-upgrades its own callers. And **`STD;24h%Volume` ("24-hour Volume") imports `PineCoders/getSeries/1 as gs`** — a third-party community library shipped inside a TradingView built-in. `[OBS]`

Full import map `[OBS]`: 24-hour Volume→PineCoders/getSeries/1; Aroon Oscillator, Chandelier Exit, KAMA, Price Momentum Oscillator, Pring's Special K, Ulcer Index→TradingView/ta/11; Net Volume, Up/Down Volume→ta/8; CVD, Volume Delta→ta/12; Relative Volume at Time→ta/7; Auto Fib Extension, Auto Fib Retracement, Auto Pitchfork→ZigZag/7; Zig Zag→ZigZag/9; Performance→ValueAtTime/2; Technical Ratings + Technical Ratings Strategy→TechnicalRating/3.

**(b) There is no Volume Profile built-in in the Pine list.** Searching all 145 `scriptName`s for "profile" returns **zero** hits `[OBS]`. The 14 volume-named built-ins are 24-hour Volume, Cumulative Volume Delta, Cumulative Volume Index, Negative/Positive Volume Index, Net Volume, On Balance Volume, Percentage Volume Oscillator, Price Volume Trend, Relative Volume at Time, Up/Down Volume, Volume Delta, VWAP, VWMA. **TradingView's Volume Profile / Fixed Range VP / Session VP tools are not Pine scripts** — they are native platform indicators outside the Pine facade `[INFER, from their absence from `filter=standard` plus the fact that every Pine built-in appears there]`. Consequence for us: there is no reference Pine implementation of Volume Profile to port; the community fills that gap (see Part 2, polylines).

**(c) `is_price_study` vs source, 3 mismatches** `[OBS]`, all benign: `Seasonality` is `is_price_study=false` but its source contains `force_overlay = true` (my regex matched `overlay = true` inside it) — this is TradingView using `force_overlay` to push a drawing onto the main pane from a pane indicator. `Chandelier Exit` and `Kaufman's Adaptive MA` are `is_price_study=true` but never write the literal `overlay=true` — they pass overlay **positionally**: `indicator("Chandelier Exit", "Chandelier", true, timeframe = "", timeframe_gaps = true)`. So `is_price_study` is the authority; a source grep for `overlay=true` is not.

### 1.6 Source inspection — 12 representative built-ins (plus 11 more, all fetched)

All fetched from `pine-facade/get/<id>/last` and read in full. **Every one is `//@version=6`.** `[OBS]`
"revision" = the list endpoint's `version` field. `×n` = number of calls.

| # | Built-in | Pine | Declaration line (verbatim) | Presentation primitives | Language features |
|---|---|---|---|---|---|
| 1 | **Simple Moving Average** | v6 | `indicator(title="Simple Moving Average", shorttitle="SMA", overlay=true, timeframe="", timeframe_gaps=true)` | `plot×4`, `fill×1` | `switch×1`, `input active=×2`, `display.×12` |
| 2 | **Relative Strength Index** | v6 | `indicator(title="Relative Strength Index", shorttitle="RSI", format=format.price, precision=2, timeframe="", timeframe_gaps=true)` | `plot×7`, `plotshape×2`, `fill×4`, `hline×3`, `alertcondition×2` | `switch×1`, `active=×2`, `display.×17` |
| 3 | **MACD** | v6 | `indicator("Moving Average Convergence Divergence", "MACD", timeframe = "", timeframe_gaps = true)` | `plot×3`, `hline×1`, `alertcondition×2` | `switch×1` |
| 4 | **Supertrend** | v6 | `indicator("Supertrend", overlay = true, timeframe = "", timeframe_gaps = true)` | `plot×3`, `fill×2`, `alertcondition×3` | uses `ta.supertrend()` built-in; `plot.style_linebr`; a hidden `display.none` "Body Middle" plot purely as a fill anchor |
| 5 | **Ichimoku Cloud** | v6 | `indicator(title="Ichimoku Cloud", shorttitle="Ichimoku", overlay=true)` | `plot×7`, `fill×1` | none — 21 lines, no library, no drawings |
| 6 | **Bollinger Bands** | v6 | `indicator(shorttitle="BB", title="Bollinger Bands", overlay=true, timeframe="", timeframe_gaps=true)` | `plot×3`, `fill×1` | `switch×1` |
| 7 | **VWAP** | v6 | `indicator(title="Volume Weighted Average Price", shorttitle="VWAP", overlay=true, timeframe="", timeframe_gaps=true)` | `plot×7`, `fill×3` | `request×4`, `runtime.error×1`, `active=×3`, `display.×16` |
| 8 | **Pivot Points Standard** *(pivot/structure)* | v6 | `indicator("Pivot Points Standard", "Pivots", overlay = true, max_lines_count = 500, max_labels_count = 500)` | `line.new×1`, `label.new×1` — **zero plots** | **`type` UDT ×2, `method` ×1, `matrix` ×1, `array` ×2**, `switch×4`, `for×3`, `request×1`, `runtime.error×2`, `active=×17` |
| 9 | **Zig Zag** *(structure)* | v6 | `indicator("Zig Zag", overlay = true, max_lines_count = 500, max_labels_count = 500)` | **none in this file** — all drawing delegated | `import TradingView/ZigZag/9 as ZigZagLib` |
| 10 | **Technical Ratings** *(table)* | v6 | `indicator("Technical Ratings", "Technicals", precision = 2)` | `plot×1`, `hline×4`, **`table.new×1`**, `alertcondition×4` | `import TradingView/TechnicalRating/3`, `method×1`, `array×5`, `request×3`, `color.from_gradient×3`, `switch×5`, `for×3` |
| 11 | **Seasonality** *(table + boxes + force_overlay)* | v6 | `indicator("Seasonality", overlay = false, max_boxes_count = 500)` | `plot×4`, **`box.new×1`**, **`table.new×1`**, `bgcolor` | **`force_overlay = true`** (the only built-in that uses it), `matrix×1`, `array×4`, `method×2`, `request×1`, `color.from_gradient×1`, `for×9` |
| 12 | **Performance** *(pure table)* | v6 | `indicator("Performance")` | **`table.new×1` only — no plot at all** | `import TradingView/ValueAtTime/2 as VAT`, `request×1`, `color.from_gradient×1`, `for×4` |

Additional 11 fetched for coverage of drawing-heavy cases `[OBS]`:

| Built-in | Pine | Declaration | Primitives / features |
|---|---|---|---|
| **Trading Sessions** | v6 | `indicator("Trading Sessions", overlay = true, max_boxes_count = 500, max_lines_count = 500, max_labels_count = 500)` | `line.new×3`, `label.new×1`, `box.new×1`, `linefill.new×1`; `type` UDT ×2, `method×4`, `array×3`, `active=×13` |
| **Auto Fib Retracement** | v6 | `indicator("Auto Fib Retracement", overlay=true)` | `line.new×2`, `label.new×1`, `linefill.new×1`, `alert()×1`; `import TradingView/ZigZag/7`; **`active=×45`, `display.×72`** (the most input-gated built-in) |
| **Auto Fib Extension** | v6 | `indicator("Auto Fib Extension", overlay=true)` | `line.new×5`, `label.new×1`, `linefill.new×1`, `chart.point×7`; **the only built-in containing a `while` loop**; `import TradingView/ZigZag/7` |
| **Auto Pitchfork** | v6 | `indicator("Auto Pitchfork", overlay = true)` | `line.new×1`, `linefill.new×3`, **`chart.point×23`** — the heaviest `chart.point` user in the library; `import TradingView/ZigZag/7` |
| **Cumulative Volume Delta** | v6 | `indicator("Cumulative Volume Delta", "CVD", format=format.volume)` | `plotcandle×1`, `hline×1`; `import TradingView/ta/12`, `runtime.error×2` |
| **Moving Average Ribbon** | v6 | `indicator("Moving Average Ribbon", shorttitle = "MA Ribbon", overlay = true, timeframe = "", timeframe_gaps = true)` | `plot×4`; `active=×16`, `display.×20`, 4 source inputs |
| **Moon Phases** | v6 | `indicator("Moon Phases", overlay = true)` | `plotshape×2`, `bgcolor×1`; `array×1`, `math.×38` |
| **RSI Divergence Indicator** | v6 | `indicator(title="RSI Divergence Indicator", format=format.price, timeframe="", timeframe_gaps=true)` | `plot×5`, `plotshape×4`, `fill×1`, `hline×3`, `alertcondition×4` |
| **Pivot Points High Low** | v6 | `indicator("Pivot Points High Low", shorttitle="Pivots HL", overlay=true, max_labels_count=500)` | `label.new×1` only — 24 lines, zero plots |
| **Gaps** | v6 | `indicator("Gaps", overlay = true, max_boxes_count = 500)` | `box.new×2`, `table.new×1`, **`table.cell×1`** (the only `table.cell` in the whole library), `alertcondition×2`; `type` UDT ×2, `method×6` |
| **Multi-Time Period Charts** | v6 | `indicator("Multi-Time Period Charts", shorttitle = "MTPC", overlay = true, max_boxes_count = 500)` | `box.new×4` | **the only built-in that declares an `enum`**; plus `type` UDT ×1, `method×1`, `switch×5` |
| **Linear Regression Channel** | v6 | `indicator("Linear Regression Channel", shorttitle="LinReg", overlay=true)` | `line.new×3`, `label.new×1`, `linefill.new×2`, `alertcondition×3` — zero plots |
| **Price Target** | v6 | `indicator("Price Target", overlay = true)` | `plot×3`, `line.new×2`, `label.new×2`, `table.new×1`, `linefill.new×1` — the most primitive-diverse built-in |

**Reading of the 12+11:** TradingView's own library is split into two clearly different codebases. The classic indicators (SMA, RSI, MACD, BB, Ichimoku, Supertrend, VWAP) are 20–140 line `plot`/`fill`/`hline` scripts with no drawing objects and no UDTs. The newer, structural ones (Pivot Points Standard, Trading Sessions, Seasonality, Gaps, Multi-Time Period Charts, Auto Fib*, Performance) use **UDTs + methods + arrays/matrices, drawing objects instead of plots, tables, and heavy `display.*` / `active=` input gating**. The dividing line is not the indicator's age but whether the output is a *series* (plot) or a *geometry / panel* (line/box/label/table).

**Six built-ins draw zero plots and zero plot-family calls at all** — Pivot Points Standard, Pivot Points High Low, Linear Regression Channel, Trading Sessions, Performance, Zig Zag (and Auto Fib Retracement/Extension, Auto Pitchfork). A renderer that only implements the plot family cannot render ~8 of TradingView's own indicators at all. `[OBS]`

---
## PART 2 — Adoption of newer Pine features

### 2.0 Method and its limits — read this before quoting any number

Three independent evidence streams, deliberately kept separate:

1. **`[DOC]` — TradingView's own record.** I pulled the full `pine-script-docs/release-notes/` page as raw HTML and stripped it to text locally (394 KB HTML → 111 KB text, **103 dated month-entries from February 2014 to August 2026**). Every date below is the verbatim month heading on that page. I also pulled the docs pages for Objects, Methods, Enums, Maps, Matrices, Libraries, Debugging, Profiling-and-optimization, Lines-and-boxes, Other-timeframes-and-data, and the v6 migration guide.
2. **`[OBS-TV]` — what TradingView itself uses.** The 142-source census in Part 1.
3. **`[OBS-COMM]` — what the community actually ships.** I fetched **453 open-source community scripts** and ran the same census. Sample = the top-300 open scripts by `agreeCount` from the local `acq/catalog.json` (6,156 catalogued scripts, 4,898 of them open-access), plus the top-40 open scripts of each of six current-generation publishers (LuxAlgo, BigBeluga, AlgoAlpha, ChartPrime, Zeiierman, BackQuant), plus all 9 catalogued libraries.

**Bias I must state, not hide:** ranking by `agreeCount` selects for **age** as well as quality — a 2019 script has had seven years to accumulate likes. So the `topOpen` cohort systematically **under**-states adoption of anything post-2022, and the per-author cohorts (also top-40 by likes) under-state each author's newest work. Treat `[OBS-COMM]` percentages as a **floor**, not a point estimate. Also: `catalog.json` was assembled by keyword/author search (see `acq/queries_done.json`), so it is not a random sample of the ~100k+ public script population; and it carries **no publish date**, so I cannot cut adoption by year — I flagged that rather than fabricating a trend line.

**Snapshot note:** `acq/catalog.json` is being written live by another process (it grew from 4,078,083 to 4,317,722 bytes during this session). Every community number below reflects the **6,156-entry state I read at 22:29 local**, not the file's later size. Re-running `cat.py` will give slightly different totals.

**One thing I checked and had to discard:** `catalog.json`'s `version` field is *not* the Pine language version (values run 1…168 plus `-1`), it is the script's revision counter — same as in `builtins.json`. Pine version can only be read from the `//@version=` pragma in the source, which is why I fetched sources.

### 2.1 Feature timeline — `[DOC]`, verbatim release-note month headings

| Feature | Shipped (release-note month heading) | Verbatim heading / phrase on that page |
|---|---|---|
| `varip` | **March 2021** | "A new keyword was added: `varip` - is similar to the `var` keyword, but variables declared with `varip` retain their values between the updates of a real-time bar." |
| **Libraries** (`library()`, `import`, `export`) | **October 2021** (with Pine v5) | "v5 is here! … **Libraries are a new type of publication.** They allow you to create custom functions for reuse in other scripts." Same entry shipped `switch` and `while`. |
| **Matrices** | **April 2022** | "New matrix functions were added: `matrix.new<type>()` - Creates a new matrix object. A matrix is a two-dimensional data structure containing rows and columns." (May 2022 added `request.security()` support for matrices and `[]` history-referencing of arrays/matrices) |
| `text_font_family` / monospace | **September 2022** | `font.family_monospace` option added |
| **UDTs / objects** (`type`) | **December 2022** | "**Pine Objects** … instantiations of the new user-defined composite types (UDTs) declared using the `type` keyword. Experienced programmers can think of UDTs as **method-less classes**." |
| **Methods** (`method`) | **February 2023** | "**Pine Script Methods** … specialized functions associated with specific instances of built-in or user-defined types … facilitates user-defined methods with the new `method` keyword." Built-in methods added for `array`, `matrix`, `line`, `linefill`, `label`, `box`, `table`. |
| **Maps** | **August 2023** | "**Pine Script Maps** … collections that hold elements in the form of **key-value pairs** … unordered and do not utilize an internal lookup index." |
| **Pine Logs** (`log.info/warning/error`) | **~2023-08-30** — announced on X, **not** on the release-notes page | TradingView's X post: "Pine Logs — Take your debugging to another level with three new logging functions and a new window to see your logs in action. This is how it looks: Pine Logs is now available to all TradingView…" Tweet id 1696939667382296904 decodes to **2023-08-30 17:35 UTC**. There is **no release-note entry** for Pine Logs; the first `log.*` mention anywhere on that page is inside a 2025 example. It *does* have a full documented section (Debugging page: "Pine Logs / Creating logs / Inspecting logs / Filtering logs / Logging level / …"). |
| `chart.point` | **September 2023** | "`chart.point.new()` - Creates a new `chart.point` object with the specified `time`, `index`, and `price`." (same entry: `request.seed()`, `ticker.inherit()`) |
| **Polylines** | **October 2023** | "**Pine Script Polylines** — Polylines are drawings that sequentially connect the coordinates from an array of **up to 10,000 chart points** using straight or curved line segments, **allowing scripts to draw custom formations that are difficult or impossible to achieve using `line` or `box` objects.**" |
| `force_overlay` | **April 2024**, restated **June 2024** | "We've added a new parameter to the `box.new()`, `label.new()`, `line.new()`, `polyline.new()`, and `table.new()` functions: `force_overlay` - If true, the drawing will display on the main chart pane, even when the script occupies a separate pane." |
| **Pine Profiler** | **May 2024** | "**Pine Profiler** — a powerful utility that analyzes the executions of all significant code in a script and displays helpful performance information next to the code lines inside the Pine Editor … insight into a script's runtime, the distribution of runtime across significant code regions, and the number of times each code region executes." Has its own docs page (*Profiling and optimization*) with an embedded video. |
| **Enums** | **June 2024** | "**Pine Script Enums** — unique data types with all possible values declared by the programmer … they enable convenient dropdown input creation with the new `input.enum()` function." |
| **Pine v6 + dynamic requests** | **November 2024** (release-notes heading) / blog post dated **December 10, 2024** | "**Introducing Pine Script v6** — Pine Script has graduated to v6! Starting today, future Pine updates will apply **exclusively** to this version… Scripts can now call `request.*()` functions with **'series string'** arguments … Additionally, it is now possible to call `request.*()` functions **inside the local scopes of loops, conditional structures, and exported library functions**." Same entry: `bool` is strictly true/false (never `na`), short-circuit `and`/`or`, `int` text sizes, `text_formatting`. The blog post also lists the v6 conversion tool, negative array indices, and removal of the 9,000-trade backtest limit via order trimming. |

**Everything after v6 (2025–2026), verbatim `[DOC]` — this is the current shipping cadence:**

| Month | What shipped |
|---|---|
| Feb 2025 | **Scope-count limit removed** (was 550 total scopes incl. functions/methods/loops/conditionals/UDTs/enums — now indefinite). New `bid` and `ask` built-in variables (only on the `"1T"` timeframe; `na` elsewhere). |
| Mar 2025 | `box.set_xloc()`. **`for` loop `to_num` boundary now re-evaluated before every iteration** (was fixed at loop entry) — a behavioural change, documented in the v6 migration guide as "Dynamic `for` loop boundaries". |
| Apr 2025 | `"PercentageLTP"` box-sizing style for `ticker.renko()/pointfigure()/kagi()`. |
| May 2025 | `time_close` / `time_close()` now retrievable for elapsed realtime bars on tick and price-based charts (Renko/line-break/Kagi/P&F/range). |
| Jun 2025 | **Libraries can export user-defined constants** — `export const float SILVER_RATIO = ...` (int/float/bool/color/string only). |
| Jul 2025 | **`active` parameter on all `input*()` functions** — greys out an input in the Settings dialog, so input state can depend on other inputs. |
| Aug 2025 | **Max string length 4,096 → 40,960 characters.** Pine Editor moved from bottom panel to **side panel** (phased), word wrap, `Alt+Z`. |
| Sep 2025 | **`plot()` gains `linestyle`** — `plot.linestyle_solid` / `_dashed` / `_dotted` (only for line-drawing `style` arguments). |
| Oct 2025 | `timeframe_bars_back` parameter on `time()` / `time_close()`. |
| Nov 2025 | `syminfo.isin` built-in variable (12-char ISIN). |
| Dec 2025 | **Line wrapping**: parenthesised expressions may now be indented by any amount including multiples of four. |
| **Jan 2026** | **Footprint requests** — new `request.footprint()` function plus two new types, **`footprint` and `volume_row`**; gives scripts per-bar buy/sell volume, volume delta, POC and Value-Area (VAH/VAL) rows. |
| Apr 2026 | **Multiline strings** (`"""…"""` / `'''…'''`, newlines and indentation preserved literally). **Sorting UDT collections** — `array.sort()`, `array.sort_indices()`, `matrix.sort()` gain a `sort_field` parameter (const int field index or const string field name). Editor "use word wrap by default". |
| Jul 2026 | **Strategy overhaul**: `calc_on_every_history_tick` (Premium/Ultimate, standard charts only — script executes once per available tick on *historical* bars); Strategy Tester renamed **strategy report**; "Bar Magnifier" replaced by a **Bar detalization** menu (`use_bar_magnifier` now just its default); margin inputs replaced by **Long/Short leverage** (`margin_long`/`margin_short` kept for back-compat and converted); new Script execution menu, Heikin Ashi mode dropdown, Limit order execution dropdown, Order execution delay input. **Automatic parentheses** on Enter in the editor. |
| **Aug 2026 (latest)** | **`once` conditional structure** — new keyword; block runs when its condition is first true on a closed bar and never again. **Binary search in UDT arrays** — `array.binary_search{,_leftmost,_rightmost}()` gain `sort_field`. **Pine Screener** can now scan any index (up to 4,000 symbols) and pick any indicator via the full Indicators dialog; **the screener only accepts indicator scripts containing at least one `plot*()` or `alertcondition()` call** — incompatible scripts are greyed out. |

### 2.2 What TradingView has publicly announced as *coming*

**Nothing.** `[DOC]` I searched the entire release-notes page for "coming soon", "we plan", "will soon", "in the future", "upcoming", "beta", "roadmap": the only hits are two unrelated 2021/2023 sentences and a single "beta" in the 2014 section. TradingView publishes **shipped** features monthly and does not publish a Pine roadmap. `[OBS]` The only forward-looking statement of substance is the v6 entry's own: *"Starting today, future Pine updates will apply exclusively to this version"* — i.e. **v5 is frozen; there is no announced v7.** Independent 2026 write-ups agree that v6 remains current as of mid-2026 `[DOC, third-party]`.

The closest thing to an in-progress feature flag is inside the built-in library itself: `extra.isBeta = true` on **Auto Key Levels** and **Auto Trend Detector**, and `isChartPattern = true` on Auto Trend Detector — both **closed-source**, so TradingView is shipping beta *pattern-detection* built-ins whose Pine is not readable `[OBS-TV]`. That is the visible edge of their roadmap.

### 2.3 Observed adoption — 453 community scripts + TradingView's own 142

**Pine language version in the wild** `[OBS-COMM]` (453 sampled, pragma read from source):

| pragma | count | % |
|---|---|---|
| `//@version=6` | 155 | **34.2%** |
| `//@version=5` | 191 | 42.2% |
| `//@version=4` | 51 | 11.3% |
| `//@version=3` | 3 | 0.7% |
| `//@version=2` | 5 | 1.1% |
| no pragma (v1) | 48 | 10.6% |

Compare `[OBS-TV]`: **141 of 142 TradingView built-ins are v6** (99.3%). TradingView migrated its own library completely; the community is roughly a third migrated in this like-weighted sample — and that third rises to **55–75% among current-generation publishers** (below). **v5 is still the plurality of popular community code 21 months after v6 shipped.**

**Feature adoption, 453 community scripts** `[OBS-COMM]` — remember these are floors:

| Feature | shipped | # scripts | % of 453 | occurrences |
|---|---|---|---|---|
| `array.*` | 2019/2021 | 241 | 53.2% | 8,432 |
| `line.new` | 2019 | 213 | 47.0% | 1,071 |
| `label.new` | 2019 | 211 | 46.6% | 868 |
| `box.new` | 2021 | 140 | 30.9% | 554 |
| `switch` | Oct 2021 | 131 | 28.9% | 331 |
| **`type` (UDT) declaration** | **Dec 2022** | **107** | **23.6%** | 285 |
| `table.new` | 2020 | 83 | 18.3% | 96 |
| **`method` declaration** | **Feb 2023** | **57** | **12.6%** | 190 |
| `for … in` | Nov 2021 | 52 | 11.5% | 193 |
| `while` | Oct 2021 | 53 | 11.7% | 144 |
| **`force_overlay`** | **Apr 2024** | **47** | **10.4%** | 228 |
| `linefill.new` | Dec 2021 | 35 | 7.7% | 76 |
| **`import` (library consumer)** | **Oct 2021** | **35** | **7.7%** | 62 |
| `chart.point` | Sep 2023 | 31 | 6.8% | 251 |
| **`polyline.new`** | **Oct 2023** | **20** | **4.4%** | 50 |
| **`input active=`** | **Jul 2025** | **14** | **3.1%** | 127 |
| `matrix.*` | Apr 2022 | 12 | 2.6% | 312 |
| **`log.*`** | **Aug 2023** | **10** | **2.2%** | 28 |
| `library()` declaration | Oct 2021 | 9 | 2.0% | 9 |
| `export` | Oct 2021 | 9 | 2.0% | 209 |
| **`map.*`** | **Aug 2023** | **8** | **1.8%** | 48 |
| `text_font_family` | Sep 2022 | 8 | 1.8% | 28 |
| **`request.*` inside an `if`/`for`/`while`/`switch` block** (dynamic requests) | **Nov 2024** | **4** | **0.9%** | — |
| **`varip`** | **Mar 2021** | **3** | **0.7%** | 32 |
| `input.enum` | Jun 2024 | 3 | 0.7% | 6 |
| **`enum` declaration** | **Jun 2024** | **2** | **0.4%** | 2 |
| `text_formatting` | Nov 2024 | 1 | 0.2% | 18 |
| `plot(… linestyle =)` | Sep 2025 | 1 | 0.2% | 1 |
| `sort_field` | Apr 2026 | 1 | 0.2% | 2 |
| multiline string `"""` | Apr 2026 | 0 | 0% | 0 |
| `once` | Aug 2026 | 0 | 0% | 0 |
| `request.footprint` | Jan 2026 | 0 | 0% | 0 |

**Adoption by publisher cohort** `[OBS-COMM]` — % of that cohort's sampled scripts using the feature. This is where the age bias partly lifts:

| feature | topOpen (n=300) | AlgoAlpha (40) | BackQuant (40) | BigBeluga (40) | ChartPrime (40) | LuxAlgo (40) | Zeiierman (40) | libraries (9) |
|---|---|---|---|---|---|---|---|---|
| `type` (UDT) | 25% | 10% | 15% | 32% | 35% | **70%** | 28% | 11% |
| `method` | 12% | 2% | 12% | 22% | 20% | **35%** | 18% | 0% |
| `polyline.new` | 4% | 2% | 0% | **15%** | 5% | 8% | 8% | 11% |
| `force_overlay` | 7% | 18% | 10% | **30%** | 22% | 2% | 8% | 0% |
| `chart.point` | 7% | 2% | 0% | 15% | 15% | 12% | **18%** | 11% |
| `box.new` | 33% | 35% | 10% | **52%** | 25% | **70%** | 45% | 0% |
| `line.new` | 50% | 42% | 22% | 65% | 72% | **82%** | 48% | 22% |
| `label.new` | 48% | 45% | 20% | 70% | **85%** | 70% | 42% | 22% |
| `table.new` | 19% | 28% | 5% | 22% | 15% | 18% | 28% | 22% |
| `plot()` | 60% | 58% | **85%** | 55% | 55% | **45%** | 60% | 22% |
| `matrix.*` | 0% | 5% | 0% | 0% | 2% | 0% | **15%** | **33%** |
| `map.*` | 2% | 0% | 0% | 2% | 0% | 0% | 0% | 11% |
| `import` | 5% | 15% | **38%** | 0% | 2% | 0% | 0% | 11% |
| `input active=` | 2% | 5% | 0% | 12% | 2% | 5% | 8% | 0% |
| `log.*` | 3% | 0% | 0% | 0% | 0% | 2% | 2% | 0% |
| `enum` | 0% | 0% | 0% | 0% | 0% | 0% | 2% | 0% |
| **v6 share** | **22%** | **68%** | **55%** | **75%** | **35%** | **5%** | **63%** | 56% |

(LuxAlgo's 5% v6 share is an artifact of the sampling: their top-40 by likes are their oldest, most-liked scripts. Their UDT usage of 70% shows they were early on v5-era UDTs, not that they avoid v6. `[INFER]`)

**The plot-vs-drawing shift, measured two ways** `[OBS-COMM]`:
- Across the whole 6,156-script `acq/catalog.json`, using TradingView's own `stats` object: **2,351 of 6,156 (38.2%)** have **zero** `plot()` calls. Community also uses two primitives TradingView's own library never touches: `plotarrow` (38 scripts) and `plotbar` (8 scripts).
- In my 453 fetched sources, **177 (39%) have no `plot()` at all**. What they draw with instead: `line.new` 75%, `label.new` 68%, `box.new` 56%, `table.new` 20%, `plotshape` 19%, `barcolor` 9%, **`polyline.new` 8%**, `plotcandle` 6%, `bgcolor` 5%.

Community plot-count distribution from the full catalog `[OBS]`: 38.2% draw 0 plots, 48.9% draw ≤1, 75.3% draw ≤4, 94% draw ≤12; the tail reaches **64 plots** (`Pivot Points CPR with M,W,D High/low`, `CPR, Camarilla & Moving Average`, `Rainbow MA Study`, `Rainbow_200`, all at 64 — which smells like a hard ceiling `[INFER, UNVERIFIED]`; four independent scripts landing on exactly 64 is more consistent with a limit than a coincidence, but I did not find a documented 64-plot cap).

### 2.4 Feature-by-feature verdict

| Feature | Shipped `[DOC]` | What it enables | TV's own use `[OBS-TV]` | Community use `[OBS-COMM]` | Verdict |
|---|---|---|---|---|---|
| **Polylines** | Oct 2023 | one drawing object joining **up to 10,000 `chart.point`s**, straight or **curved**, open or **closed** and fillable; explicitly for "formations difficult or impossible with `line` or `box`" | **0 of 142** | **20 of 453 (4.4%)**, but concentrated exactly where they matter: **volume profiles, liquidity heatmaps, curved SMC/anchored-VWAP** (Volume Profile with Node Detection [LuxAlgo], Money Flow Profile [LuxAlgo], Multi-Layer Volume Profile [BigBeluga], Open Liquidity Heatmap [BigBeluga], Liquidity Price Depth Chart [LuxAlgo], Swing Profile [BigBeluga], Gann Box (Zeiierman), Curved SMC Probability (Zeiierman), Pine3D rendering engine). 15% of BigBeluga's sampled scripts. | **Adopted by the frontier, ignored by TradingView.** Low headline % but it is the enabling primitive for the highest-liked modern script category. If a renderer omits polylines it cannot draw the class of indicator that is currently winning attention. |
| **UDTs / objects** | Dec 2022 | composite types, method-less classes; the basis for order-block/zone/pivot record-keeping | 4 of 142 (Gaps, MTPC, Pivot Points Standard, Trading Sessions) | **107 of 453 (23.6%)**, 70% at LuxAlgo, 32–35% at BigBeluga/ChartPrime | **The single most-adopted new language feature.** Community is far ahead of TradingView here. |
| **Methods** | Feb 2023 | dot-notation on UDTs and built-in types | 6 of 142 | **57 of 453 (12.6%)**, 35% LuxAlgo | Real, follows UDTs at roughly half the rate. |
| **Maps** | Aug 2023 | unordered key→value collections | **0 of 142** | **8 of 453 (1.8%)** — Trendoscope Auto Chart Patterns, two Flux Charts MTF scripts, three LuxAlgo, BigBeluga Open Liquidity Heatmap, Pine3D | **Niche.** Used where a symbol/level must be keyed (MTF caches, heatmap buckets). Do not treat as mainstream. |
| **Matrices** | Apr 2022 | 2-D numeric structures | 2 of 142 (Pivot Points Standard, Seasonality) | 12 of 453 (2.6%) but **312 occurrences** — heavy inside a few scripts; 15% of Zeiierman, **33% of libraries** | **Library-layer feature.** Concentrated in stats/ML-ish code, rare in indicators. |
| **Enums** | Jun 2024 | closed value sets + `input.enum()` dropdowns | **1 of 142** (Multi-Time Period Charts) | **2 of 453 declare an `enum` (0.4%)**; 3 use `input.enum` | **Near-zero adoption two years in.** The lowest-uptake language feature I measured. |
| **`force_overlay`** | Apr 2024 | draw on the price pane from a pane indicator (and vice versa) | 1 of 142 (Seasonality) | **47 of 453 (10.4%), 228 occurrences**; **30% of BigBeluga, 22% of ChartPrime, 18% of AlgoAlpha** | **Fastest-adopted new *visual* parameter in the set** — 10% in ~28 months, and it is a hard requirement for the "dashboard in a pane + marks on price" pattern the modern publishers use. |
| **Dynamic requests / `request.*` in loops** | Nov 2024 (v6) | one `request.*` call whose symbol/timeframe changes per bar; `request.*` legal inside loops, conditionals, exported library functions | 14 of 142 use `request.*` at all; **0 use `request.security_lower_tf`; none in a loop** | **4 of 453 (0.9%)** have a `request.*` inside a conditional/loop block; 3 of the 4 are v6 (Support and Resistance (MTF) \| Flux Charts, Whale Liquidity and Absorption Profile [AlgoAlpha], Open Interest Z-Score [BackQuant]) | **Headline v6 feature, essentially unadopted.** This is the biggest gap between marketing prominence and observed use. `[INFER]` most likely because 40-request/scan limits and repainting risk still bind, and because the pattern requires v6 *and* a rewrite. |
| **`varip`** | Mar 2021 | value survives realtime-bar ticks | **0 of 142** | **3 of 453 (0.7%)** but 32 occurrences (concentrated) | **Effectively dead in published code.** 5+ years old, lowest adoption of anything measured. Rational: `varip` breaks bar-replay/backtest reproducibility, and published scripts are judged on historical charts. `[INFER]` |
| **Libraries (`import`/`export`)** | Oct 2021 | reusable published functions, version-pinned | **19 of 142 built-ins import (13%)** — TradingView eats its own dog food, incl. one *community* library | consumers: **35 of 453 (7.7%)**; producers: only **9 libraries surfaced in the whole 6,156-script catalogue**; `export` appears 209 times across those 9 | **Asymmetric.** Consumption is real (and TradingView's own rate, 13%, is nearly double the community's); production is a tiny specialist activity. Caveat: `catalog.json` was built from indicator-shaped keyword/author queries, so libraries are structurally under-sampled — the 9 is a floor on presence, **not** a population estimate `[OBS, biased sample]`. Note 4 pinned versions of `TradingView/ta` in simultaneous use. |
| **Pine Profiler** | May 2024 | per-line/per-region runtime + execution counts in the editor | n/a (editor tool) | not observable in source | **Exists and is documented** with its own manual page ("Profiling and optimization") and an embedded video. I found **no plan gate stated** in that page (searched for plan/Premium/Ultimate/available-to: no hits). Adoption unmeasurable from source `[OBS: unmeasurable]`. |
| **Pine Logs** | ~2023-08-30 (X post; **no release-note entry**) | `log.info/warning/error` into a dedicated pane, click-to-jump-to-bar, level filters, regex/date/custom-code filters | **0 of 142** | **10 of 453 (2.2%)** | **Documented as the primary debugging technique** (Debugging page leads with it) yet almost absent from published code — expected, since logs are a development-time tool you strip before publishing `[INFER]`. |
| **`input active=`** | Jul 2025 | grey out an input conditionally | **23 of 142 (16%), 205 occurrences** — incl. Auto Fib Retracement with 45 | **14 of 453 (3.1%)** | **Inverted adoption: TradingView uses it 5× more than the community.** It is a settings-panel polish feature and TradingView retrofitted its whole library within ~14 months. Anything trying to look like a native built-in needs it. |
| **`plot(linestyle=)`** | Sep 2025 | dotted/dashed plotted lines | 0 of 142 | 1 of 453 | Too new to read. |
| **Multiline strings / `once` / `request.footprint` / `sort_field`** | Apr 2026 / Aug 2026 / Jan 2026 / Apr 2026 | — | 0 | 0, 0, 0, 1 | Too new; `request.footprint` also needs Premium/Ultimate data. |

### 2.5 PineCoders as a source — stale, and that is the finding

`[DOC]` `pinecoders.com` is still organised around **Pine v5**, and their **FAQ & Code** resource is written against **`//@version=4`** ("An important change to the way conditional statement blocks are evaluated was introduced with v4 of Pine"). Its section list — Built-in variables, Built-in functions, Operators, Math, Indicators, Strategies, Plotting, Text, Labels and Lines, **Arrays**, Time/dates/Sessions, Other Timeframes, Alerts, Editor, Techniques, Debugging — has **no section on objects/UDTs, methods, maps, matrices, enums, polylines, libraries, `varip` or `force_overlay`**. There is no dated "last updated" marker and no prescriptive commentary about adopting newer features.

So: **there is no PineCoders commentary on the modern feature set to cite.** Anyone citing "PineCoders recommend X" about UDTs/polylines/enums is citing something that does not exist on those pages as of 2026-09-08. The live signal about modern practice is in the scripts themselves (§2.3) and in TradingView's docs, not in the community hub. PineCoders is, however, still a *producer* — `PineCoders/getSeries/1` is imported by a TradingView built-in `[OBS-TV]`.

### 2.6 Third-party write-ups: useful for dates, unreliable for attribution

`[DOC, third-party]` Several 2025–2026 blogs (TradersPost, Pineify, PineScripter, jayadevrana) cover v6 and the 2025–2026 monthly updates, and they correctly report that **v6 is still current as of mid-2026 and there is no v7**. But at least one search-surfaced summary asserts "Pine Script v6 launched in November 2024 with enums, dynamic requests, runtime logging, polylines, and stricter boolean handling" — **three of those five are wrong**: polylines shipped Oct 2023, enums Jun 2024, Pine Logs Aug 2023, all under **v5**. Only dynamic requests and bool strictness are v6 features. Do not date features from secondary sources; the release-notes month headings are the authority.

---

## PART 3 — What this means for a Pine-compatible renderer

`[INFER]` from the measurements above, flagged as opinion:

1. **Plot-family-only is not "TradingView parity."** 107/145 built-ins use `plot`, but `hline` (42/142) and `fill` (28/142) are the next two most common primitives and neither is in the `stats` object at all. ~8 TradingView built-ins draw **nothing** through the plot family.
2. **`stats` from the facade list is a screening signal, never a coverage metric.** It counts 5 primitives out of ~20. `STD;Zig_Zag` reports `{}`.
3. **Priority order implied by the data** (TV built-ins ∪ community floors): `plot` → `hline` → `fill` → `line.new` → `label.new` → `box.new` → `plotshape` → `table.new` → `linefill.new` → `bgcolor`/`barcolor` → `chart.point` → **`polyline.new`** → `plotcandle` → `plotchar` → `plotarrow`/`plotbar` (community only).
4. **`force_overlay` is not optional chrome** — 10.4% of community scripts and 30% of BigBeluga's use it; without it, pane indicators cannot mark the price pane, which is the dominant modern layout.
5. **`display.*` and `active=` are the invisible parity gap.** 41/142 built-ins pass `display.*` (409 occurrences) and 23/142 use `active=` (205 occurrences). These control which outputs reach the Data Window / status line / price scale and which inputs are editable. Ignoring them makes a "correct" render still look wrong.
6. **UDT/method support in the language layer buys 24%/13% of community scripts; enums and maps buy ~2% and ~0.4%.** If a Pine-subset interpreter must triage, UDTs + methods + arrays are the high-yield set; enums, maps and `varip` can wait; dynamic-`request`-in-loops is currently a 0.9% feature.
7. **Assume v5 input, not v6.** 42% of the popular community corpus is still v5 and 12% is v4-or-older; only TradingView's own library is uniformly v6.

---

## Sources

**Endpoints (fetched live 2026-09-08):**
- `https://pine-facade.tradingview.com/pine-facade/list/?filter=standard` (already captured at `acq/builtins.json`)
- `https://pine-facade.tradingview.com/pine-facade/get/<urlencoded scriptIdPart>/last` — 145 built-ins + 453 community scripts

**TradingView documentation:**
- [Pine Script release notes](https://www.tradingview.com/pine-script-docs/release-notes/) — primary date authority, 103 dated entries Feb 2014 → Aug 2026
- [Objects](https://www.tradingview.com/pine-script-docs/language/objects/) · [Methods](https://www.tradingview.com/pine-script-docs/language/methods/) · [Enums](https://www.tradingview.com/pine-script-docs/language/enums/) · [Maps](https://www.tradingview.com/pine-script-docs/language/maps/) · [Matrices](https://www.tradingview.com/pine-script-docs/language/matrices/)
- [Libraries](https://www.tradingview.com/pine-script-docs/concepts/libraries/) · [Lines and boxes](https://www.tradingview.com/pine-script-docs/visuals/lines-and-boxes/) (polyline limits: 500 lines / 500 boxes / **100 polylines**, default ~50 each; `xloc.bar_index` ±500 future / 10,000 past bars; drawings cannot be created inside `request.*()` contexts)
- [Debugging](https://www.tradingview.com/pine-script-docs/writing/debugging/) (Pine Logs section) · [Profiling and optimization](https://www.tradingview.com/pine-script-docs/writing/profiling-and-optimization/) · [Other timeframes and data](https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/) · [v6 migration guide](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/)
- [Pine Script® v6 has landed](https://www.tradingview.com/blog/en/pine-script-v6-has-landed-48830) — blog, dated **December 10, 2024**

**Community:**
- [PineCoders](https://www.pinecoders.com/) (v5-era) · [PineCoders FAQ & Code](https://www.pinecoders.com/faq_and_code/) (**v4-era**)
- [TradingView on X — Pine Logs announcement](https://x.com/tradingview/status/1696939667382296904) (tweet id decodes to 2023-08-30 17:35 UTC)
- Third-party, used only for cross-checking "is v6 still current": [TradersPost — v6 release notes explained](https://blog.traderspost.io/article/pine-script-v6-release-notes-explained), [TradersPost — 12 updates Feb 2025–Jan 2026](https://blog.traderspost.io/article/pine-script-updates-2025-2026), [Pineify — v6 + migration](https://pineify.app/resources/blog/pine-script-v6-everything-you-need-to-know), [jayadevrana — Pine Script latest version July 2026](https://jayadevrana.com/pine-script-latest-version-2026/)

## Reproduction artifacts (left on disk, outside `acq/`)

`scratchpad/tvsrc/`
- `all/*.json` — all 145 built-in fetch results (142 with `source`, 3 with the 401)
- `comm/*.json` — 453 community script fetch results; `comm_cohorts.json` — cohort membership
- `docs/*.txt` — stripped text of the 11 docs pages; `rn.html` / `rn.txt` — release notes
- `census.py` (built-in primitive census), `diff.py` (`stats` vs counted, no-pragma, overlay mismatch), `twelve.py` (the inspected set), `mktable.py` (the 145-row table), `cat.py` (catalog aggregates), `comm2.py` + `commcensus.py` (community sample + census), `loopreq.py` (dynamic-request heuristic, no-plot analysis), `rn.py` / `rn2.py` / `rn3.py` (release-note segmentation)

---

## Appendix A — all 145 built-ins

`srcInputs` = `extra.sourceInputsCount`. `Pine` = `//@version` pragma read from the fetched source. The five numeric columns are `extra.stats`; blank = absent. The last column is my own regex census over the fetched source, so it is empty (`—`) only when the source genuinely uses none of them, and `(no source)` for the 3 closed scripts.

| # | Built-in | `scriptIdPart` | kind | overlay/pane | srcInputs | Pine | stats.plot | plotshape | plotchar | plotcandle | alertcondition | other primitives found in source |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 24-hour Volume | `STD;24h%Volume` | study | pane | 1 | v6 | 1 |  |  |  |  | import×1 request×2 |
| 2 | Accumulation/Distribution | `STD;Accumulation_Distribution` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 3 | Advance Decline Line | `STD;Advance%1Decline%1Line` | study | pane | 0 | v6 | 1 |  |  |  |  | request×1 |
| 4 | Advance Decline Ratio | `STD;Advance%1Decline%1Ratio` | study | pane | 0 | v6 | 1 |  |  |  |  | request×2 |
| 5 | Advance/Decline Ratio (Bars) | `STD;Advance_Decline_Ratio_Bars` | study | pane | 0 | v6 | 1 |  |  |  |  | hline×1 |
| 6 | Arnaud Legoux Moving Average | `STD;Arnaud%1Legoux%1Moving%1Average` | study | overlay | 0 | v6 | 1 |  |  |  |  | — |
| 7 | Aroon | `STD;Aroon` | study | pane | 0 | v6 | 2 |  |  |  |  | — |
| 8 | Aroon Oscillator | `STD;Aroon_Oscillator` | study | pane | 0 | v6 | 2 |  |  |  |  | fill×1 hline×3 import×1 |
| 9 | Auto Fib Extension | `STD;Auto%1Fib%1Extension%1` | study | overlay | 0 | v6 |  |  |  |  |  | line×5 label×1 linefill×1 alert×1 import×1 array×28 |
| 10 | Auto Fib Retracement | `STD;Auto%1Fib%1Retracement%1` | study | overlay | 0 | v6 |  |  |  |  |  | line×2 label×1 linefill×1 alert×1 import×1 |
| 11 | Auto Key Levels | `STD;Auto_Key_Levels` | study | overlay | 0 | n/a (source not public) | 21 |  |  |  |  | (no source) |
| 12 | Auto Pitchfork | `STD;Auto%1Pitchfork` | study | overlay | 0 | v6 |  |  |  |  |  | line×1 linefill×3 import×1 array×1 |
| 13 | Auto Trend Detector | `STD;Auto_Trend_Detector` | study | overlay | 0 | n/a (source not public) |  |  |  |  |  | (no source) |
| 14 | Average Daily Range | `STD;Average%Day%Range` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 15 | Average Directional Index | `STD;Average%1Directional%1Index` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 16 | Average True Range | `STD;Average_True_Range` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 17 | Awesome Oscillator | `STD;Awesome_Oscillator` | study | pane | 0 | v6 | 1 |  |  |  | 2 | — |
| 18 | Balance of Power | `STD;Balance%1of%1Power` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 19 | BarUpDn Strategy | `STD;Bars%1Up%1Dn%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 20 | BBTrend | `STD;BBTrend` | study | pane | 0 | v6 | 1 |  |  |  |  | hline×1 |
| 21 | Bollinger Bands | `STD;Bollinger_Bands` | study | overlay | 1 | v6 | 3 |  |  |  |  | fill×1 |
| 22 | Bollinger Bands %b | `STD;Bollinger_Bands_B` | study | pane | 1 | v6 | 1 |  |  |  |  | fill×3 hline×5 |
| 23 | Bollinger Bands Strategy | `STD;Bollinger%1Bands%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 24 | Bollinger Bands Strategy directed | `STD;Bollinger%1Band%1Directed%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 25 | Bollinger BandWidth | `STD;Bollinger_Bands_Width` | study | pane | 1 | v6 | 3 |  |  |  |  | — |
| 26 | Bollinger Bars | `STD;Bollinger%1Bars` | study | overlay | 0 | v6 |  |  |  | 2 |  | — |
| 27 | Bull Bear Power | `STD;Bull%Bear%Power` | study | pane | 0 | v6 | 1 |  |  |  |  | hline×1 |
| 28 | Chaikin Money Flow | `STD;Chaikin_Money_Flow` | study | pane | 0 | v6 | 1 |  |  |  |  | hline×1 |
| 29 | Chaikin Oscillator | `STD;Chaikin_Oscillator` | study | pane | 0 | v6 | 1 |  |  |  |  | hline×1 |
| 30 | Chande Kroll Stop | `STD;Chande%1Kroll%1Stop` | study | overlay | 0 | v6 | 2 |  |  |  |  | — |
| 31 | Chande Momentum Oscillator | `STD;Chande_Momentum_Oscillator` | study | pane | 1 | v6 | 1 |  |  |  |  | hline×1 |
| 32 | Chandelier Exit | `STD;Chandelier_Exit` | study | overlay | 0 | v6 | 2 |  |  |  |  | import×1 |
| 33 | ChannelBreakOutStrategy | `STD;Channel%1BreakOut%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 34 | Chop Zone | `STD;Chop%1Zone` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 35 | Choppiness Index | `STD;Choppiness_Index` | study | pane | 0 | v6 | 1 |  |  |  |  | fill×1 hline×3 |
| 36 | Commodity Channel Index | `STD;CCI` | study | pane | 1 | v6 | 4 |  |  |  |  | fill×2 hline×3 |
| 37 | Connors RSI | `STD;Connors_RSI` | study | pane | 0 | v6 | 1 |  |  |  |  | fill×1 hline×3 |
| 38 | Consecutive Up/Down Strategy | `STD;Consecutive%1Ups%1Downs%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 39 | Coppock Curve | `STD;Coppock%1Curve` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 40 | Correlation Coefficient | `STD;Correlation_Coeff` | study | pane | 1 | v6 | 1 |  |  |  |  | hline×3 request×1 |
| 41 | Cumulative Volume Delta | `STD;Cumulative%1Volume%1Delta` | study | pane | 0 | v6 |  |  |  | 1 |  | hline×1 import×1 |
| 42 | Cumulative Volume Index | `STD;Cumulative%1Volume%1Index` | study | pane | 0 | v6 | 1 |  |  |  |  | request×2 |
| 43 | Detrended Price Oscillator | `STD;DPO` | study | pane | 0 | v6 | 1 |  |  |  |  | hline×1 |
| 44 | Directional Movement Index | `STD;DMI` | study | pane | 0 | v6 | 3 |  |  |  |  | — |
| 45 | Donchian Channels | `STD;Donchian_Channels` | study | overlay | 0 | v6 | 3 |  |  |  |  | fill×1 |
| 46 | Double EMA | `STD;DEMA` | study | overlay | 1 | v6 | 1 |  |  |  |  | — |
| 47 | Ease of Movement | `STD;EOM` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 48 | Elder Force Index | `STD;EFI` | study | pane | 0 | v6 | 1 |  |  |  |  | hline×1 |
| 49 | Envelope | `STD;ENV` | study | overlay | 1 | v6 | 3 |  |  |  |  | fill×1 |
| 50 | Fisher Transform | `STD;Fisher_Transform` | study | pane | 0 | v6 | 2 |  |  |  |  | hline×5 |
| 51 | Gaps | `STD;Gaps` | study | overlay | 0 | v6 |  |  |  |  | 2 | box×2 table×1 UDT×2 method×6 array×2 |
| 52 | Greedy Strategy | `STD;Greedy%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 53 | Historical Volatility | `STD;Historical_Volatility` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 54 | Hull Moving Average | `STD;Hull%1MA` | study | overlay | 1 | v6 | 1 |  |  |  |  | — |
| 55 | Ichimoku Cloud | `STD;Ichimoku%1Cloud` | study | overlay | 0 | v6 | 7 |  |  |  |  | fill×1 |
| 56 | InSide Bar Strategy | `STD;InSide%1Bar%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 57 | Kaufman's Adaptive Moving Average | `STD;Kaufmans_Adaptive_Moving_Average` | study | overlay | 1 | v6 | 1 |  |  |  |  | import×1 |
| 58 | Keltner Channels | `STD;Keltner_Channels` | study | overlay | 1 | v6 | 3 |  |  |  |  | fill×1 |
| 59 | Keltner Channels Strategy | `STD;Keltner%1Channel%1Strategy` | strategy | overlay | 1 | v6 |  |  |  |  |  | — |
| 60 | Klinger Oscillator | `STD;Klinger%1Oscillator` | study | pane | 0 | v6 | 2 |  |  |  |  | — |
| 61 | Know Sure Thing | `STD;Know_Sure_Thing` | study | pane | 0 | v6 | 2 |  |  |  |  | hline×1 |
| 62 | Least Squares Moving Average | `STD;Least%1Squares%1Moving%1Average` | study | overlay | 1 | v6 | 1 |  |  |  |  | — |
| 63 | Linear Regression Channel | `STD;Linear_Regression` | study | overlay | 1 | v6 |  |  |  |  | 3 | line×3 label×1 linefill×2 |
| 64 | MA Cross | `STD;MA%1Cross` | study | overlay | 0 | v6 | 3 |  |  |  |  | — |
| 65 | MACD Strategy | `STD;MACD%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 66 | Mass Index | `STD;Mass%1Index` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 67 | McGinley Dynamic | `STD;McGinley%1Dynamic` | study | overlay | 0 | v6 | 1 |  |  |  |  | — |
| 68 | Median | `STD;Median` | study | overlay | 1 | v6 | 4 |  |  |  |  | fill×1 |
| 69 | Momentum | `STD;Momentum` | study | pane | 1 | v6 | 1 |  |  |  |  | — |
| 70 | Momentum Strategy | `STD;Momentum%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 71 | Money Flow Index | `STD;Money_Flow` | study | pane | 0 | v6 | 1 |  |  |  |  | fill×1 hline×3 |
| 72 | Moon Phases | `STD;Moon%1Phases` | study | overlay | 0 | v6 |  | 2 |  |  |  | bgcolor×1 array×1 |
| 73 | Moving Average Convergence Divergence | `STD;MACD` | study | pane | 1 | v6 | 3 |  |  |  | 2 | hline×1 |
| 74 | Moving Average Exponential | `STD;EMA` | study | overlay | 1 | v6 | 4 |  |  |  |  | fill×1 |
| 75 | Moving Average Ribbon | `STD;MA%Ribbon` | study | overlay | 4 | v6 | 4 |  |  |  |  | — |
| 76 | Moving Average Weighted | `STD;WMA` | study | overlay | 1 | v6 | 1 |  |  |  |  | — |
| 77 | MovingAvg Cross | `STD;MovingAvg%1Cross%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 78 | MovingAvg2Line Cross | `STD;MovingAvg%1Cross2%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 79 | Multi-Time Period Charts | `STD;Multi-Time%Period%Charts` | study | overlay | 0 | v6 |  |  |  |  |  | box×4 UDT×1 method×1 enum×1 request×1 |
| 80 | Negative Volume Index | `STD;Negative_Volume_Index` | study | pane | 0 | v6 | 2 |  |  |  |  | — |
| 81 | Net Volume | `STD;Net%1Volume` | study | pane | 0 | v6 | 1 |  |  |  |  | hline×1 import×1 |
| 82 | On Balance Volume | `STD;On_Balance_Volume` | study | pane | 0 | v6 | 4 |  |  |  |  | fill×1 |
| 83 | Open Interest | `STD;Open%Interest` | study | pane | 0 | v6 | 1 |  |  | 1 |  | request×2 |
| 84 | OutSide Bar Strategy | `STD;OutSide%1Bar%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 85 | Parabolic SAR | `STD;PSAR` | study | overlay | 0 | v6 | 1 |  |  |  |  | — |
| 86 | Parabolic SAR Strategy | `STD;Parabolic%1SAR%1Strategy` | strategy | overlay | 0 | v6 | 2 |  |  |  |  | — |
| 87 | Percentage Price Oscillator | `STD;Price_Oscillator` | study | pane | 1 | v6 | 3 |  |  |  |  | hline×1 |
| 88 | Percentage Volume Oscillator | `STD;Volume%1Oscillator` | study | pane | 0 | v6 | 3 |  |  |  |  | hline×1 |
| 89 | Performance | `STD;Performance` | study | pane | 0 | v6 |  |  |  |  |  | table×1 import×1 request×1 |
| 90 | Pivot Extension Strategy | `STD;Pivot%1Extension%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 91 | Pivot Points High Low | `STD;Pivot%1Points%1High%1Low` | study | overlay | 0 | v6 |  |  |  |  |  | label×1 |
| 92 | Pivot Points Standard | `STD;Pivot%1Points%1Standard` | study | overlay | 0 | v6 |  |  |  |  |  | line×1 label×1 UDT×2 method×1 matrix×1 array×2 request×1 |
| 93 | Pivot Reversal Strategy | `STD;Pivot%1Reversal%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 94 | Positive Volume Index | `STD;Positive_Volume_Index` | study | pane | 0 | v6 | 2 |  |  |  |  | — |
| 95 | Price Channel Strategy | `STD;Price%1Channel%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 96 | Price Momentum Oscillator | `STD;Price_Momentum_Oscillator` | study | pane | 1 | v6 | 2 |  |  |  |  | hline×1 import×1 |
| 97 | Price Target | `STD;Price%1Target` | study | overlay | 0 | v6 | 3 |  |  |  |  | line×2 label×2 table×1 linefill×1 |
| 98 | Price Volume Trend | `STD;Price_Volume_Trend` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 99 | Pring's Special K | `STD;Prings_Special_K` | study | pane | 1 | v6 | 2 |  |  |  |  | hline×1 import×1 |
| 100 | Rank Correlation Index | `STD;Rank_Correlation_Index` | study | pane | 1 | v6 | 4 |  |  |  |  | fill×2 hline×3 |
| 101 | Rate Of Change | `STD;ROC` | study | pane | 1 | v6 | 1 |  |  |  |  | hline×1 |
| 102 | RCI Ribbon | `STD;RCI_Ribbon` | study | pane | 1 | v6 | 3 |  |  |  |  | fill×1 hline×3 |
| 103 | Relative Strength Index | `STD;RSI` | study | pane | 1 | v6 | 7 | 2 |  |  | 2 | fill×4 hline×3 |
| 104 | Relative Vigor Index | `STD;Relative_Vigor_Index` | study | pane | 0 | v6 | 2 |  |  |  |  | — |
| 105 | Relative Volatility Index | `STD;Relative_Volatility_Index` | study | pane | 0 | v6 | 4 |  |  |  |  | fill×2 hline×3 |
| 106 | Relative Volume at Time | `STD;Relative%1Volume%1at%1Time` | study | pane | 0 | v6 | 1 |  |  |  |  | hline×1 import×1 |
| 107 | RelativeValue | `PUB;LIB_TradingView_RelativeValue` | library | pane | 0 | n/a (source not public) | 3 |  |  |  |  | (no source) |
| 108 | Rob Booker - ADX Breakout | `STD;Rob%1Booker%1ADX%1Breakout%1Strategy` | strategy | overlay | 0 | no pragma | 4 |  |  |  |  | bgcolor×1 |
| 109 | Rob Booker - Ziv Ghost Pivots | `STD;Rob%1Booker%1Ghost%1Pivots%1v2` | study | overlay | 0 | v6 | 1 |  | 4 |  |  | request×4 |
| 110 | RSI Divergence Indicator | `STD;Divergence%1Indicator` | study | pane | 1 | v6 | 5 | 4 |  |  | 4 | fill×1 hline×3 |
| 111 | RSI Strategy | `STD;RSI%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 112 | Seasonality | `STD;Seasonality` | study | pane | 0 | v6 | 4 |  |  |  |  | box×1 table×1 method×2 matrix×1 array×4 force_overlay×1 request×1 |
| 113 | Simple Moving Average | `STD;SMA` | study | overlay | 1 | v6 | 4 |  |  |  |  | fill×1 |
| 114 | SMI Ergodic Indicator | `STD;SMI_Ergodic_Indicator_Oscillator` | study | pane | 0 | v6 | 2 |  |  |  |  | — |
| 115 | SMI Ergodic Oscillator | `STD;SMI_Ergodic_Oscillator` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 116 | Smoothed Moving Average | `STD;Smoothed%1Moving%1Average` | study | overlay | 1 | v6 | 1 |  |  |  |  | — |
| 117 | Stochastic | `STD;Stochastic` | study | pane | 0 | v6 | 2 |  |  |  |  | fill×1 hline×3 |
| 118 | Stochastic Momentum Index | `STD;SMI` | study | pane | 0 | v6 | 3 |  |  |  |  | fill×3 hline×3 |
| 119 | Stochastic RSI | `STD;Stochastic_RSI` | study | pane | 1 | v6 | 2 |  |  |  |  | fill×1 hline×3 |
| 120 | Stochastic Slow Strategy | `STD;Stochastic%1Slow%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 121 | Supertrend | `STD;Supertrend` | study | overlay | 0 | v6 | 3 |  |  |  | 3 | fill×2 |
| 122 | Supertrend Strategy | `STD;Supertrend%Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 123 | Technical Ratings | `STD;Technical%1Ratings` | study | pane | 0 | v6 | 1 |  |  |  | 4 | hline×4 table×1 import×1 method×1 array×5 request×3 |
| 124 | Technical Ratings Strategy | `STD;Technical%1Ratings%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | import×1 request×1 |
| 125 | Time Weighted Average Price | `STD;Time%1Weighted%1Average%1Price` | study | overlay | 1 | v6 | 1 |  |  |  |  | — |
| 126 | Trading Sessions | `STD;Trading%1Sessions` | study | overlay | 0 | v6 |  |  |  |  |  | line×3 label×1 box×1 linefill×1 UDT×2 method×4 array×3 |
| 127 | Trend Strength Index | `STD;Trend%1Strength%1Index` | study | pane | 0 | v6 | 2 |  |  |  |  | fill×2 hline×3 |
| 128 | Triple EMA | `STD;TEMA` | study | overlay | 0 | v6 | 1 |  |  |  |  | — |
| 129 | TRIX | `STD;TRIX` | study | pane | 0 | v6 | 1 |  |  |  |  | hline×1 |
| 130 | True Strength Index | `STD;True%1Strength%1Indicator` | study | pane | 0 | v6 | 2 |  |  |  |  | hline×1 |
| 131 | Ulcer Index | `STD;Ulcer_Index` | study | pane | 1 | v6 | 2 |  |  |  |  | fill×1 hline×1 import×1 |
| 132 | Ultimate Oscillator | `STD;Ultimate_Oscillator` | study | pane | 0 | v6 | 1 |  |  |  |  | — |
| 133 | Up/Down Volume | `STD;UP_DOWN_Volume` | study | pane | 0 | v6 | 2 |  | 1 |  |  | import×1 |
| 134 | Visible Average Price | `STD;Visible%1Average%1Price` | study | overlay | 1 | v6 | 1 |  |  |  |  | array×3 |
| 135 | Volatility Stop | `STD;Volatility_Stop` | study | overlay | 1 | v6 | 1 |  |  |  |  | — |
| 136 | Volty Expan Close Strategy | `STD;Volty%1Expan%1Close%1Strategy` | strategy | overlay | 0 | v6 |  |  |  |  |  | — |
| 137 | Volume Delta | `STD;Volume%1Delta` | study | pane | 0 | v6 |  |  |  | 1 |  | hline×1 import×1 |
| 138 | Volume Weighted Average Price | `STD;VWAP` | study | overlay | 1 | v6 | 7 |  |  |  |  | fill×3 request×4 |
| 139 | Volume Weighted Moving Average | `STD;VWMA` | study | overlay | 1 | v6 | 1 |  |  |  |  | — |
| 140 | Vortex Indicator | `STD;Vortex%1Indicator` | study | pane | 0 | v6 | 2 |  |  |  |  | — |
| 141 | Williams Alligator | `STD;Williams_Alligator` | study | overlay | 0 | v6 | 3 |  |  |  |  | — |
| 142 | Williams Fractals | `STD;Whilliams_Fractals` | study | overlay | 0 | v6 |  | 2 |  |  |  | — |
| 143 | Williams Percent Range | `STD;Willams_R` | study | pane | 1 | v6 | 1 |  |  |  |  | fill×1 hline×3 |
| 144 | Woodies CCI | `STD;Woodies%1CCI` | study | pane | 0 | v6 | 3 |  |  |  |  | hline×3 |
| 145 | Zig Zag | `STD;Zig_Zag` | study | overlay | 0 | v6 |  |  |  |  |  | import×1 |