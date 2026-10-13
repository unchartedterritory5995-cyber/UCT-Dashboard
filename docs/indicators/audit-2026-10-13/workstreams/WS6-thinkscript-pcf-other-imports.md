# WS6 — thinkScript, TC2000 PCF, screenshot, natural-language and library imports

Audit of production `84164aee3d` (worktree `C:/w/indaud`, branch `audit/indicators-competitive-2026-10-13`), 2026-10-13.
This is an audit only: no runtime code, tests or config were changed. The scratch harnesses live in
`app/src/__audit_scratch__/ws6/`, which is not committed. The corpus files written for this audit are in
`docs/indicators/audit-2026-10-13/migration-corpus/{thinkscript,pcf}/`.

---

## 0. Headline

| # | Severity | Finding |
|---|---|---|
| 1 | **P0** | **TC2000 `STOC` gives wrong values and reports "Exact import".** `PCF_FUSED.STOC` passes `stoch(close, high, low, n)`. The engine's `stoch` takes `(high, low, close, n)` (`closedTable.json:1264-1279` argRoles; `interpret.js:2768`; `ast_interpret.py:2206`). The result runs from −146 to +97 on a 0–100 oscillator. `STOC14.3 < 20` disagrees with the correct stochastic on **122 of 400** synthetic bars, firing 187 times against a correct 65. The import is labelled "Exact import", and the read-back looks plausible: "the 3-bar average of (the 14-bar stochastic %K of close, high and low)". The repo's own `pine.roles.test.js:128-139` and `VENDOR_PARITY_TRANCHE_2_LANE_A_STOCH_REPORT.md §8` show that this exact argument order is wrong. `pcf.vocabulary.test.js:292-301` *pins* the wrong tree by comparing it with the native text `stoch(close, high, low, 14)`. |
| 2 | **P0** | **A thinkScript higher-timeframe (`close(period = AggregationPeriod.WEEK/MONTH)`) put inside `Average`/`[n]`/any function is computed on DAILY bars and reported as exact.** `Average(close(period=WEEK), 10)` becomes `sma(tf(close,'W'), 10)`, which is a 10-*day* mean of the last-closed weekly close. thinkorswim's semantics are a 10-*week* average over the secondary aggregation, which is also what the community corpus relies on (`tests/fixtures/thinkscript/22-…ts`, where `dayrange[1]` means the previous day). On synthetic bars, 0 of 120 tail bars agree with either the forming-week or the closed-week 10-week SMA, with a maximum relative error of 9.6–12.2%. `close(period=WEEK)[1]` becomes `tf(close,'W')[1]`, which is *one daily bar* back. The user is told "Imported, with disclosed differences — differences in how it is drawn only; **the values are the same**". The forming-week versus last-closed-week difference (a one-week lag) is not disclosed either. The Pine door gets this right (`tf(sma(close,10),'W')`). |
| 3 | P1 | A plain Stock Hacker one-liner such as `close > Average(close, 50) and volume > 500000` is routed to the **TC2000** reader. It is refused at `close` with advice that it "reads like this engine's own formula syntax", which is the wrong door and the wrong advice. `close > close[1] and volume > volume[1]` is refused as a TC2000 character error. |
| 4 | P1 | The most common thinkScript study references are refused: `RSI()`, `RSI(14)`, all of `MACD(…)`, `StochasticFull`, `KeltnerChannels`, `ADX`, `VWAP`, `GetValue`, `Crosses()` in function form, `rec` running counters and ratchets, and `fold` (except a rolling sum). Only 10 of the 24 pinned public studies translate (`thinkscript.corpus.test.js:387`). |
| 5 | P1 | Everything visual in a thinkScript study is dropped. This covers painting strategy (arrows, histogram, points), colours, line weight and style, `AssignValueColor`, clouds, `AssignPriceColor`, labels and bubbles. `declare lower/upper` is dropped too, and thinkScript's default is *upper*, yet every import lands in the lower pane because `BuilderSheet.jsx:1006` defaults to `'pane'`. Constant level plots (70/30, zero) are dropped, so their levels are lost. Inputs are frozen to literals at save, so no knobs survive. |
| 6 | P2 | Several user-facing sentences are false for this surface. Constant plots are said to be "hidden by the script itself" (`importOutcome.js`, info bucket). `declare` "a screened column has no chart to be placed on" and `Alert` "a screen has nowhere to deliver" use screen-only framing inside the *indicator* builder. Library intake tells a valid TC2000 formula "this does not read as Pine, thinkScript or a TC2000 formula". |
| 7 | P2 | 9 pre-existing backend test failures at production head: `test_starter_library.py` ×4 and `test_definition_concierge.py` ×5. One shows starter-library grounding rot: "Classic Flag/Pullback" cites a screener starter, `starter_leaders_pullback`, that no longer exists. |

What works well, measured. PCF is the strongest door. 14 of 16 of my PCF formulas import, and **13 of the 14 that import are numerically exact** against my own implementation on the converged tail (the exception is STOC). TC2000 offsets (`C1`, `C.1`, `AVGC50.5`, `MAXV10.1`, `C(3)`), `XUP`/`XDOWN` (with an honest semantic note), `COUNTTRUE`/`TRUEINROW`/`SINCETRUE`, `IIF`, `WRSI`, `ATR`, `MACD`, the market-cap unit conversion and the `RSI`→`WRSI` look-alike refusal all hold up. On thinkScript, everything that does translate (other than MTF) matches to 1e-9 on the tail, and the ExpAverage seed difference is disclosed. Refusals are specific, positioned at the token and generally honest. No lookahead is introduced: negative offsets, `HighestAll` and non-zero `displace` are all refused.

---

## 1. Pipeline per language

### 1.1 thinkScript

| Stage | Where | What happens |
|---|---|---|
| Detection | `dialect.js:61-91` (`THINKSCRIPT_MARKERS`); `PineBox.jsx:249-288` (`routeAndInspect`) | Markers: `def/plot/input/rec` at line start, `declare …`, `Double.NaN`, chrome calls, `crosses above`, `AggregationPeriod.`, `AverageType.`. A native-formula refusal for an unknown capitalised thinkScript name (e.g. `Average`) is **re-routed** to thinkScript (`PineBox.jsx:265-270`). ⚠️ A paste with `and`/`or` and no thinkScript marker is detected as PCF first (see §4, F3). |
| Lex/parse | `thinkscript.js:580` `lexThinkScript`, `:703` `readStatements`, `:2265` `readProgram` | Its own lexer and a binding-power expression parser over thinkorswim's 12-level operator table. Statements: `declare`, `input` (incl. enum), `def`/`rec`, forward declaration + one-name `if`/`switch` block, `plot`, chrome method/calls (listed, skipped). |
| Translate | `Resolver` (`thinkscript.js` ~3100-4560); `TS_CALL_SHAPES:2497` (35 cited names); `TS_DOC_BLOCKED:1534`; `TS_HARD_GUARDS:1482` | Every call goes through a **cited** shape. There is no name-collision fallback (deliberate, `:3062-3080`). Inputs are folded to literals (`folded[]`). Self-reference → bounded `accum` only for "replace" shapes. `close(period=W/M)` → `tf` node **wrapping only the field** (`:3869-3871`). `close(symbol="SPY")` → `sym`. Output: one canonical tree per `plot`, printed to native formula text and round-trip-verified (`:4597-4760`). |
| Outcome | `importOutcome.js:143` | `exact` / `disclosed` / `partial` / `unsupported` / `error`. Chrome notes → PRESENTATION ("values are the same"). `note-seed`/`note-warmup` → SEMANTIC. |
| Execution | `interpret.js:4333` (browser), `ast_interpret.py` (server) | The saved native tree runs through the same evaluator as a typed formula. |
| Render | `PineBox.jsx:900-940` → `BuilderSheet` | Each usable non-constant plot becomes a plot row with **default** presentation (`presentation: null` — thinkscript emits none). Target pane defaults to `'pane'` (`BuilderSheet.jsx:1006`). |
| Save/reload | `ImportBox.thinkscript.test.jsx:215-258` | The saved document is **byte-identical to the native formula typed by hand** and "nothing in it remembers it was thinkScript" (asserted). The original thinkScript text and its inputs are not kept. Reload/edit happens in native syntax. `applyProvenanceFor` is Pine-only (`BuilderSheet.jsx:451-460`). |
| Consumers | shared canonical tree | Indicator (chart), Condition/scan (boolean outputs, or a numeric column + an offered comparison `ImportBox.toScreen.test.jsx`), alerts (bind to the definition's tree). Library intake (`libraryIntake.js`) reads thinkScript too, but splits multi-script pastes only on Pine `//@version`, so a folder of thinkScripts is read as one script. |

### 1.2 TC2000 PCF

| Stage | Where | What happens |
|---|---|---|
| Detection | `pcf.js:1645-1680` (`PCF_MARKERS`, `NATIVE_MARKERS`) | Native unless something is unambiguously TC2000 (AND/OR/NOT words, `<>`, fused `AVGC50`, bare `C`/`C1`, single `=`). Native markers (`&&`, `||`, `==`, `?`, `let`) always win. |
| Parse/translate | `pcf.js:1495` `parsePcf` | A single expression (faithful to TC2000, where a PCF is one expression). Fused families `PCF_FUSED:175`, call forms `PCF_CALLS:370`, stateful `PCF_STATEFUL` → `accum`, `IIF`, derived logic `XOR/NAND/NOR/XNOR`, `^`/`MOD`/`\`, `CAPITALIZATION`/`MARKETCAP` (÷1e6). Offsets → the canonical `offset` node (`applyOffset`, negative refused). Look-alikes refused by name (`PCF_DIFFERENT_FORMULA:272`: RSI, FAVG, WSTOC, OBV, MS, TSV). |
| Source of truth | `readFormulaSource` (`pcf.js:1762`), `defSchema.js:98,856` | **The PCF text itself is the stored source**. `defSchema` re-reads it in its own dialect and checks `astHash` against the stored tree. |
| Execution | same evaluator, both lanes | |
| Render | Formula tab / Import tab | One output (`kind: 'formula'`). |
| Save/reload | `BuilderSheet.pcf.test.jsx:99-245` | Types, reads back in English, saves. Reload shows the member's own PCF. |
| Consumers | indicator, condition/scan (primary use), sort column (numeric PCF), alerts — all via the canonical tree. |

### 1.3 Other doors (section 6)
Screenshot → `ImageBox.jsx` → `POST /api/indicator-vision/candidates` → `indicator_from_image.candidates_from_image` → `definition_concierge._validate`. Natural language → `ConciergeBox` (`/propose`) or `ConverseBox` (`/converse`). Starter library → `StarterLibrary.jsx` over `starterScans.json`. Pine libraries → `pine_library_store.py`.

---

## 2. Construct matrices

Legend: **P** parses, **T** translates, **E** executes, **R** renders as authored, **S** saves and reloads. ✅ yes, ⚠️ partial/with caveat, ❌ no, — n/a.
Evidence is either my scratch probes (`debug.test.js`, `corpus.test.js`) or the cited tests.

### 2.1 thinkScript

| Construct | P | T | E | R | S | Notes / evidence |
|---|---|---|---|---|---|---|
| `def`, `plot`, quoted plot names, forward decl | ✅ | ✅ | ✅ | ⚠️ default style | ✅ native | corpus 01–04 |
| `input` numeric | ✅ | ✅ folded | ✅ | ⚠️ paste-time field only | ❌ knob lost; literal | `PineBox.jsx:82-99`, `memberInputs` absent for thinkscript |
| `input` enum `{default A, B}` + `switch` | ✅ | ✅ dead arms folded | ✅ | — | ❌ choice frozen | corpus 11 (MA plot) |
| `AverageType.*` input + `MovingAverage` | ✅ | ✅ SMA/EMA/WMA/Wilder/Hull | ✅ exact | — | ⚠️ frozen | corpus 13: WMA, HMA exact |
| `declare lower/upper` | ✅ | ❌ note only | — | ❌ always lower pane (default `'pane'`) | — | `thinkscript.js:2129-2135`; `BuilderSheet.jsx:1006` |
| `SetPaintingStrategy` / `SetDefaultColor` / `SetLineWeight` / `SetStyle` / `AssignValueColor` / `Hide` | ✅ | ❌ listed as skipped | — | ❌ | — | `TS_CHROME_METHODS:1847`; rpw local work in progress (§7) |
| `AddCloud`, `AssignPriceColor`, `AddLabel`, `AddChartBubble`, `AddVerticalLine`, `AssignBackgroundColor` | ✅ | ❌ listed | — | ❌ | — | `TS_CHROME_CALLS:1861`; a label-only study → `no-output` (corpus 05) |
| `Alert(…)` | ✅ | ❌ listed ("a screen has nowhere to deliver") | — | — | — | not mapped to the product's alerts |
| `if … then … else` (incl. `else if`) | ✅ | ✅ | ✅ | — | ✅ | probe `ifElseIf` |
| `if/switch` block assigning one name | ✅ | ✅ | ✅ | — | ✅ | `readAssignmentBlock` |
| multi-statement blocks, `script {}` subs | ✅ | ❌ `:block` | — | — | — | probe `script` |
| `CompoundValue` | ✅ | ⚠️ only shapes that forget their seed; running counters refused `:state` | ⚠️ | — | — | corpus 11 `DaysAbove` refused; probe `compoundStreak` |
| `rec` / self-reference `x[1]` | ✅ | ⚠️ needs `IsNaN(x[1])` / `CompoundValue` seed; ratchets with `Max(x[1],…)` refused | ⚠️ 250-bar warm-up | — | — | corpus 06 refused; `thinkscript.selfref.test.js` |
| `fold` | ✅ | ⚠️ only the rolling-sum shape | ⚠️ | — | — | `thinkscript.fold.test.js:31-100`; corpus 08 refused |
| `GetValue` | ✅ | ❌ `:function` | — | — | — | probe |
| `Average`, `ExpAverage`, `WildersAverage`, `Sum`, `StDev` (population), `Highest`, `Lowest`, `TrueRange`, `ATR`, `Inertia`, `Covariance`, `Correlation`, maths fns, `IsNaN`, `Double.NaN`, `HL2/HLC3/OHLC4` | ✅ | ✅ cited | ✅ exact (EMA seed disclosed) | — | ✅ | corpus 01–04, 08b, 13, 15 |
| `RSI(length=…, price=…)`, `BollingerBands(…all named…).LowerBand`, `SimpleMovingAvg/MovAvgExponential(… displace = 0)` | ✅ | ✅ | ✅ exact | — | ✅ | corpus 10b exact |
| `RSI()` / `RSI(14)` / study defaults | ✅ | ❌ `:arity` "publishes no default" (one-click conventional call offered) | — | — | — | corpus 10; `ImportBox.thinkscript.test.jsx:372-573` |
| `MACD`, `StochasticFull`, `KeltnerChannels`, `ADX`, `DMI`, `VWAP`, `reference X` | ✅ | ❌ | — | — | — | probes |
| `TTM_Squeeze` | ✅ | ❌ proprietary (correct) | — | — | — | `:2999` |
| `HighestAll`/`LowestAll`/`TotalSum`/`StDevAll` | ✅ | ❌ (correct: request-dependent) | — | — | — | |
| `crosses above/below`, `crosses` | ✅ | ✅ (prior-bar `<=` convention stated) | ✅ exact | — | ✅ | corpus 01 |
| `Crosses(a, b, CrossingDirection.X)` function | ❌ `:syntax` (poor message) | ❌ | — | — | — | corpus 15 |
| `close(period = WEEK/MONTH)` | ✅ | ⚠️ **field only**; outer fns run on daily bars | ❌ **wrong value** | — | ✅ (saves the wrong value) | **P0**, §4 F2 |
| `close(period = DAY)` / intraday periods / `GetAggregationPeriod()` | ✅ | ❌ (DAY "absolute") | — | — | — | probes |
| `close(symbol = "SPY")` | ✅ | ✅ `sym` (benchmark roster) | ✅ | — | ✅ | probe `symbolSpy`; `close("QQQ")` positional refused |
| `GetTime`, `SecondsFromTime`, `BarNumber`, `RegularTradingStart` | ✅ | ❌ hard guard (honest) | — | — | — | corpus 14 |
| `AddOrder` / strategies | ✅ | ❌ hard guard | — | — | — | |
| negative offset `close[-1]` | ✅ | ❌ (correct: no lookahead) | — | — | — | probe |
| enumerations (`AverageType`, `AggregationPeriod`, `Color`, `PaintingStrategy`) | ✅ | ⚠️ AverageType/AggregationPeriod only | | | | |
| `na` / `IsNaN` | ✅ | ✅ `na(…)`, `0/0` | ✅ | — | ✅ | corpus 15 `Valid` exact |

### 2.2 TC2000 PCF

| Construct | P | T | E | S | Notes |
|---|---|---|---|---|---|
| `O H L C V` (any case) | ✅ | ✅ | ✅ | ✅ PCF text kept | corpus 15 |
| offsets `C1`, `C.1`, `C(3)`, `AVGC50.5`, `MAXV10.1` | ✅ | ✅ `offset` node | ✅ exact | ✅ | corpus 02, 16; negative refused |
| `AVGx`, `XAVGx`, `HAVGx`, `MAXx`, `MINx` (any field) + call forms | ✅ | ✅ | ✅ exact (XAVG seed **not disclosed**) | ✅ | corpus 01, 02, 05, 09 |
| `WRSI` | ✅ | ✅ Wilder | ✅ exact | ✅ | corpus 06 |
| `RSI` (TC2000 plain) | ✅ | ❌ named refusal + `WRSI14` suggestion | — | — | corpus 07, honest |
| `MACDa.b` | ✅ | ✅ | ✅ exact (seed undisclosed) | ✅ | corpus 09 |
| `STOCa.b[.z]` | ✅ | ⚠️ **wrong argument order** | ❌ **wrong value** | ✅ (wrong) | **P0**, F1 |
| `STDDEV`, Bollinger via `AVGC20 ± 2*STDDEV20` | ✅ | ✅ population SD | ✅ matches population | ✅ | TC2000's divisor is not verified against the vendor |
| `ATR`, `CCI`, `ADXa.a`, `DIPLUS/DIMINUS`, `AROONUP/DOWN`, `BOP` | ✅ | ✅ (`high, low, close` order correct) | ATR exact (corpus 12); others not checked | ✅ | |
| `AND OR NOT XOR NAND NOR XNOR`, `+ - * / ^ MOD \`, `++/+-/-+/--`, comparisons, `<>`, `=` | ✅ | ✅ | ✅ | ✅ | |
| `ABS SQR LOG CLG EXP SGN SIN COS TAN ARCTAN SINH SUM GREATEST LEAST` | ✅ | ✅ | ✅ (ABS checked) | ✅ | |
| `XUP` / `XDOWN` | ✅ | ✅ `crossOver` | ✅ (differs only on an exact touch, disclosed) | ✅ | corpus 08; `PCF_XUP_NOTE` |
| `COUNTTRUE`, `TRUEINROW`, `SINCETRUE` (−1 sentinel) | ✅ | ✅ `accum` | ✅ exact (COUNTTRUE) | ✅ | corpus 13 |
| `IIF` | ✅ | ✅ | ✅ | ✅ | |
| `Capitalization` / `MarketCap` (millions) | ✅ | ✅ ÷1e6 | ✅ | ✅ | `pcf.ownerScans.test.js` |
| other fundamentals (`EPS`, `PE`, `Sector`, …) | — | ❌ `pcf:name` (bare) / misrouted to native | — | — | corpus 14; probes `pe`, `eps` land on the *native* door with "did you mean `pb`/`peg`" |
| `FAVG`, `WSTOC`, `OBV`, `MS`, `TSV` | ✅ | ❌ named, honest (proprietary/unpublished) | — | — | |
| `BARSSINCE`, `BB…`, timeframe suffixes | ❌ | ❌ `pcf:name` | | | probes |
| Dialog rows (`Price History`, `Volume (Dollars)`, `Price as % of 52wk high`) | ✅ | ❌ named, with a workaround | | | `PCF_DIALOG_INDICATORS:846` |

TC2000 semantics. Periods are bars of the timeframe the scan runs on, and the engine's are bars too, so they are consistent. Offsets are trailing (`.z` = z bars back) and correct. Volume is in shares, which is consistent with the owner's real scans (`pcf.ownerScans.test.js:38`). The volume unit is not stated on screen.

---

## 3. Migration corpus results

Bars: 420 deterministic synthetic daily bars (weekdays, with a sine drift and volume spikes). Each output was evaluated with the real `interpret()` over the tree that `inspectSource()` (the production Import-tab door) produced. My independent implementations: SMA/WMA/HMA; EMA seeded EMA1 = price1 (thinkorswim's published seed); Wilder RSMA seeded with the SMA; population and sample SD; true range; and weekly closes built from the bars. "Tail" means bars 300–419, after convergence. "Exact" means |Δ| ≤ 1e-9·max(1,|ref|).

### 3.1 thinkScript (`migration-corpus/thinkscript/`)

| Script | Outcome (label — reason) | Plots ok/total | Numeric (tail) | Visuals kept/lost | Inputs | Save/edit | Verdict |
|---|---|---|---|---|---|---|---|
| 01 ma-cross-arrows | Imported, with disclosed differences — "1 difference can change a value or when it appears" (ExpAverage seed) | 4/4 | FastMA 120/120 exact (all-bars max rel 0.1% in warm-up); SlowMA, Buy/Sell 100% | lost: colours, width, both arrow strategies (0/1 drawn as lines), upper placement → lower pane | 9, 21 paste-time only | native text; no knobs | ⚠️ values right, looks wrong |
| 02 rsi-lower-clouds | disclosed — "differences in how it is drawn only; the values are the same" | 1/3 (70/30 dropped as constants) | RSIValue 406/406 exact | lost: 2 clouds, colour, dashed levels, **levels themselves**; `declare lower` honoured only by accident (default pane) | 14 paste-time; 70/30 dropped | ✅ | ⚠️ |
| 03 macd-hist-valuecolor | disclosed — "2 differences can change a value…" (seed ×2) | 1/2 (zero line dropped) | Hist 120/120 tail exact; early bars diverge (seed) | lost: histogram style → line, value colour, width | 12/26/9 paste-time | ✅ | ⚠️ |
| 04 squeeze-from-math | disclosed — "…the values are the same" | 2/2 | SqueezeOn 420/420 (1 warm-up bar), Momentum exact | lost: histogram, value colour, points, red dots | 20/2.0/1.5 paste-time | ✅ | ✅ maths / ⚠️ visuals |
| 05 relvol-label (label only) | Not supported — "nothing in this script offers a value a screen could read" | 0/0 | — | label lost | — | — | ❌ (honest) |
| 05b relvol + plot | disclosed — "…values are the same" | 1/1 | exact | lost: histogram, label | 50 paste-time | ✅ | ⚠️ |
| 06 rec-trailing-stop (CompoundValue ratchet) | Not supported — `thinkscript:state` long sentence (quoted §5) | 0/1 | — | — | — | — | ❌ |
| 07 mtf-weekly-average | disclosed — "differences in how it is drawn only; **the values are the same**" | 2/2 "ok" | **0/120 agree**; max rel err 9.6% (vs forming-week 10-wk SMA), 12.2% (vs closed-week) | colour lost | 10 paste-time | ✅ saves wrong maths | ❌ **P0** |
| 08 fold-up-days | Not supported — "a fold loop repeats an expression, and this engine stores one expression rather than a program" | 0/1 | — | — | — | — | ❌ |
| 08b sum-up-days (rewrite) | disclosed — drawn-only | 1/1 | 411/411 exact | — | 10 paste-time | ✅ | ✅ |
| 09 inside-bar-paint | disclosed — drawn-only | 1/1 | 420/420 exact | lost: price-bar paint, points, colour | — | ✅ | ⚠️ |
| 10 study-reference (`RSI(14)`, `MACD(12,26,9).Diff`) | Not supported — "`price` has no value, and thinkorswim publishes no default for it — …writing them yourself — RSI(length = 14, price = close) translates today…" | 0/1 | — | — | — | — | ❌ (MACD unmapped even after fixing RSI) |
| 10b study-ref all named | **Exact import** | 1/1 | 420/420 exact | — | — | ✅ | ✅ |
| 11 switch-enum + CompoundValue streak | **Partial import** — "not imported: DaysAbove" | 1/2 | MA exact | — | enum frozen to SMA | ✅ MA only | ⚠️ (honest partial) |
| 12 scan + Alert | disclosed — drawn-only | 1/1 | 420/420 exact | Alert listed, not wired to alerts | — | ✅ | ✅ |
| 13 MovingAverage(AverageType…) | **Exact import** | 2/2 | WMA, HMA exact | — | frozen | ✅ | ✅ |
| 14 session (SecondsFromTime) | Not supported — `thinkscript:time` (session clock; ms vs s; early close) | 0/2 | — | — | — | — | ❌ (correct for daily) |
| 15 IsNaN + `Crosses()` fn | Not supported — "this thinkScript line does not end where a statement has to end" at `Crosses` | 1/2 translated, but script refused | `Valid` exact | — | — | ❌ | ❌ message misleading |

Summary: 11 of 18 import (2 exact, 8 disclosed, 1 partial). One of those 11 (07) is numerically wrong while claiming the values are the same. All other translated plots are exact on the tail. 0 of 18 keep any visual styling.

### 3.2 PCF (`migration-corpus/pcf/`)

| Formula | Outcome | Numeric | Notes | Verdict |
|---|---|---|---|---|
| 01 `C > AVGC50 AND AVGC50 > AVGC200` | Exact import | 420/420 | | ✅ |
| 02 pocket-pivot-ish `… V > MAXV10.1 …` | Exact | 420/420 | offset on a rolling max correct | ✅ |
| 03 inside day `H < H1 AND L > L1` | Exact | 420/420 | | ✅ |
| 04 3-weeks-tight-ish (C5/C10/C15) | Exact | 420/420 | | ✅ |
| 05 gap up + volume | Exact | 420/420 | | ✅ |
| 06 `WRSI14 < 30 AND C > AVGC200` | Exact | 420/420 | | ✅ |
| 07 `RSI14 < 30` | Not supported — "…TC2000's plain RSI is not Wilder's RSI, so it is not converted. For Wilder's RSI …TC2000 writes WRSI with the same period: `WRSI14`" | — | honest, actionable | ✅ refusal |
| 08 `XUP(C, AVGC50)` | Imported, with disclosed differences (XUP note) | 120/120 tail (50 warm-up NaN) | | ✅ |
| 09 `MACD12.26 > XAVG(MACD12.26, 9)` | Exact | tail 120/120; 21 early bars differ (EMA seed, **undisclosed**) | | ⚠️ label |
| 10 `STOC14.3 < 20 AND C < AVGC20 - 2*STDDEV20` | **Exact import** | combined bool 119/120 (BB clause masks it); the STOC part itself is **wrong on 122/400 bars** | **P0** | ❌ |
| 11 `100*(C-C21)/C21` (sort) | Exact | 399/399 | numeric column; usable as a sort/plot | ✅ |
| 12 `C >= 0.95*MAXH252 AND ATR14/C < 0.04` | Exact | 420/420 (ATR = Wilder) | | ✅ |
| 13 `COUNTTRUE(C > C1, 10) >= 7` | Exact | 420/420 | | ✅ |
| 14 `C > AVGC50 AND EPS > 0` | Not supported — "this is not a TC2000 name this reader knows — `EPS` at character 15" | — | no hint about fundamentals | ⚠️ |
| 15 `c > avgc50 and v > 1000000` | Exact | 420/420 | lower case works | ✅ |
| 16 `C > AVGC50.5 AND C.1 < AVGC50.6` | Exact | 420/420 | dotted offsets | ✅ |

---

## 4. Silent semantic differences and honesty of reporting

**F1 — P0 — `STOC` argument order.**
- Evidence: `pcf.js:196` (`series: ['close', 'high', 'low']`); `closedTable.json:1264-1279`; `interpret.js:2768` `stoch: (h, l, c, n)`; `ast_interpret.py:2206` `_fn_stoch(h, l, c, n)`.
- Measured with `__audit_scratch__/ws6/stoch.test.js`: engine `stoch(close,high,low,14)` = `100*(low − lowest(high))/(highest(close) − lowest(high))`, which matched on 390 of 390 bars. Range −146.6…97.3.
- `stochImpact.test.js`:
  - `STOC14.3 < 20` disagrees on 122/400 bars (fires 187 times versus a correct 65).
  - `STOC14.3 > 80` disagrees on 84/400 (27 versus 109).
  - `STOC14.1 < 20` disagrees on 115/400.
- What the user is shown: "Exact import" with the read-back "1 when (the 3-bar average of (the 14-bar stochastic %K of close, high and low)) is less than 20 and 0 otherwise".
- Both lanes agree on the wrong value, so the chart, the scan and the alert are consistently wrong.
- The rail that should catch it pins it instead: `pcf.vocabulary.test.js:292-301`.
- The likely root cause is the stale prose in `closedTable.json::_functions_indicators` ("`stoch(source, high, low, length)` is already the shape Pine uses"), which contradicts the `argRoles` added later (`b3935da25e`).

**F2 — P0 — thinkScript MTF inside functions/offsets.**
- `thinkscript.js:3869-3871` returns `{type:'tf', value, args:[field]}`. Every enclosing call (`Average`, `Highest`, `[n]`, `crosses`) is then resolved over the base (daily) bars.
- The Pine door wraps the whole expression instead: `request.security(…,"W",ta.sma(close,10))` → `tf(sma(close, 10), 'W')`, measured in `debug.test.js`.
- Measured:
  - engine `WeeklyMA` = `sma` over 10 *daily* values of the last-closed weekly close. This is identical to my reconstruction `sma(tf,10 daily)` (71.3435 / 71.2445 / 71.0350).
  - Correct 10-week SMA, forming week: 72.48 / 72.62 / 72.08.
  - Closed weeks only: 73.11 / 73.11 / 72.62.
  - `close(period=WEEK)[1]` → `tf(close,'W')[1]`, which is the same weekly value as one *daily* bar earlier, not the prior week's close.
- Secondary undisclosed difference: thinkorswim's secondary aggregation on a daily chart reads the forming week (it repaints until Friday). The engine reads the last closed week (non-repainting, lagging up to a week). That is defensible, but it must be said.
- Reported to the user as "Imported, with disclosed differences — differences in how it is drawn only; the values are the same".
- Existing rails only check tree shape (`thinkscript.aggregation.test.js:35-170`), so nothing evaluates a composed MTF expression against a weekly reference.
- Caveat: the vendor semantics come from thinkorswim's secondary-aggregation behaviour as relied on by the public corpus (`22-average-daily-range-zones.ts` uses `dayrange[1]` … `[10]` as previous days). They should be confirmed against a captured thinkorswim value before the fix ships, but the engine is wrong under either reading of the week.

**F3 — P1 — detection sends thinkScript scans to the TC2000 reader.**
`detect.test.js`:
- `close > Average(close, 50) and volume > 500000` → dialect `pcf`, "this is not a TC2000 name this reader knows — `close` at character 0. This reads like this engine's own formula syntax (lower-case names such as `close` and `sma(…)`), where `and` and `or` are written `&&` and `||`…". Both the dialect and the advice are wrong.
- `close > close[1] and volume > volume[1]` → "this character has no meaning in TC2000 syntax — `[` at character 13".
- `RSI(length = 14, price = close) < 30` → refused by PCF at `length`.

Cause: `dialect.js:93-98`. thinkScript markers require `def/plot/…` or chrome, and the AND/OR word marker makes it PCF. The re-route (`PineBox.jsx:265`) only fires from the *native* refusal, never from PCF.

**F4 — P2 — false or screen-only sentences on the indicator surface.**
- Constant plots: `importOutcome.js` info bucket says "hidden by the script itself, so not offered" (corpus 02 `Upper`/`LowerLvl`, 03 `ZeroLine`). The study did not hide them; they are constant levels. The row renderer is correct ("The same number on every bar and every symbol — a screen cannot answer from it.", `PineBox.jsx:1190-1196`), so the two disagree.
- `note-declare`: "a chart placement is a drawing instruction, and a screened column has no chart to be placed on". The import also builds chart indicators.
- `Alert`: "raises an alert, which a screen has nowhere to deliver". The product has alerts.
- The chrome-notes toggle reads "Show N lines a screen does not read". It is accurate for scans, but for an indicator import it hides what the *chart* lost.
- Outcome "differences in how it is drawn only; the values are the same" is true in all cases except F2.

**F5 — P2 — EMA seed disclosure is thinkScript-only.** PCF `XAVG`/`MACD` use the same SMA-seeded `ema` (21 early-bar disagreements on corpus 09) and are labelled "Exact import" with no note. TC2000's own seed is unverified. Also not vendor-verified, though labelled exact: TC2000 `STDDEV` divisor, `ATR` smoothing, `MACD`.

**F6 — P2 — inputs and placement silently normalised.** thinkScript inputs become literals. The Import box offers "Settings from the script — set them here, before you save", but after save there is no knob, and the saved document says nothing about where the numbers came from. `declare lower`/default-upper is not carried: every import defaults to the lower pane. Constant plots (OB/OS, zero) are dropped rather than becoming levels.

Partial-conversion honesty is generally good:
- Plots that do not translate become "Partial import — not imported: DaysAbove".
- Hard guards block the whole script, with a reason.
- Every refusal carries the token, line, caret excerpt and the source stamp (`ImportBox.thinkscript.test.jsx:288-330`).
- Chrome lines are listed, never swallowed.

The refusal prose is often very long. The `thinkscript:state` text in corpus 06 is a 90-word sentence: "this value carries forward from bar to bar in a way the bounded accumulator cannot hold — this engine's accumulator re-seeds a fixed number of bars back rather than running from the first bar ever drawn, so it can only carry an update that stops depending on the value it started from, and it cannot tell that this one does. A value REPLACED outright on some bars — `if <condition> then <newValue> else <name>[1]` — is the shape it can carry; a running total that only ever adds to itself is not, and would come out as a rolling window over the last 250 bars instead". It is accurate but hard to act on for a trader.

---

## 5. UX walkthrough (Import tab, thinkScript)

1. Builder → **Import** tab. Hint: "A TradingView Pine indicator, a thinkorswim thinkScript study, a TC2000 formula, or one of this engine's own. Everything the screen would read is listed below…" (`PineBox.jsx:1046-1052`).
2. Paste. Debounced re-read. The header says "Read as thinkScript study" (the detected dialect). A re-route adds "— read as thinkScript: `Average` is a thinkorswim name".
3. Status line: **Exact import / Imported, with disclosed differences / Partial import / Not supported / Import failed**, then the reason. Semantic notes are listed (e.g. the ExpAverage seed).
4. "This script offers N columns": radio rows with the native formula and its English read-back. Constant plots appear as greyed "hidden" rows. Refused plots show the refusal with a caret.
5. "Settings from the script — set them here, before you save" holds the paste-time numeric inputs, which are re-translated with the new literal.
6. For a documentation-blocked study (RSI/BB/MovAvgExponential/SimpleMovingAvg) the refusal offers the conventional call with a one-click apply on the member's own number (`ImportBox.thinkscript.test.jsx:464-573`). This is a good pattern.
7. A numeric column offers "turn into a screen" with a comparison and threshold.
8. "Show N lines a screen does not read" expands the chrome list.
9. **Use this formula** puts the native formula or plots into the builder. Placement defaults to the lower pane, default colours, no levels. Save writes an ordinary native definition. Re-opening shows native syntax, and the thinkScript is gone.

PCF: typed directly in the Formula tab (detected automatically) or via Import. The read-back is in English, the PCF text is saved verbatim, and reload shows the member's own TC2000 text. This is a clean experience.

---

## 6. Screenshot, natural-language and library imports

### 6.1 Screenshot importer (`api/services/indicator_from_image.py`, `api/routers/indicator_vision.py`, `ImageBox.jsx`)

- **What it does.** One image (png/jpeg/gif/webp, ≤5 MB) plus an optional note (≤400 chars, in its own delimited block) goes to one forced tool call (`emit_candidates`). The tool schema is the concierge's AST node schema. The call returns up to `INDICATOR_VISION_CANDIDATES` (default 3, max 8) candidate **trees**, each with the model's `label`/`saw`/`confidence`. The model never writes the formula text or the read-back: `source = formula_for(tree)` and `sentence = sentence_for(tree)`.
- **Gates, in order:**
  - `require_paid` (402);
  - `INDICATOR_VISION_ENABLED`, dark by default, checked in the handler before charging; it answers "reading an indicator from a picture is not switched on -- paste the script on the Import tab, or build it on the Formula tab";
  - a bars cap (`MAX_PROPOSE_BARS`, graceful refusal);
  - an hourly per-user limit, `INDICATOR_VISION_MAX_PER_HOUR` (default 10), charged *before* the model call. It is process-local, so it is per pod;
  - media type and size checks;
  - `cost_guard.may_member_spend` (global member budget) before the call, with every call recorded;
  - 0 HTTP retries and a 60 s client timeout.
- **Verification.** Each candidate goes through `definition_concierge._validate`: schema → canonical shape → budget → lint/repaint → evaluation over the member's bars. A refused candidate is returned with its gate and **no formula**. Unexpected exceptions become `vision:internal`, not "no candidate". Nothing is persisted; Accept writes `source` into the Formula box (`BuilderSheet.jsx:3021-3030`), which re-runs every typed-formula gate.
- **What verification does not do.** There is no check that a candidate *resembles the picture*. "Verified" means valid, budgetable, non-repainting and computable, not "this is the indicator in the screenshot". The UI says so permanently: "A picture does not tell us the formula. These are the engine's best guesses…" (`ImageBox.jsx:53-60`).
- **Access.** The Image tab is visible to everyone in the builder. Whether production has `INDICATOR_VISION_ENABLED` on cannot be read from code (no prod reads, per the rules). Default model `claude-opus-5` (`INDICATOR_VISION_MODEL`).
- **Tests.** `tests/test_indicator_from_image.py` passed (mocked client; no paid calls). `ImageBox.test.jsx` passed.

### 6.2 Natural language (architecture and gates only)

- **`/propose` (ConciergeBox, one-shot).**
  - Gates: `require_paid`, then the `PROPOSE_MAX_PER_HOUR` window (default 40), then the bars cap.
  - A deterministic `plan()` step comes first: the concept vocabulary must understand the prompt, otherwise the request is refused before any model call.
  - Then at most `MAX_MODEL_CALLS = 2` (generate plus one repair) with a forced tool and the per-user daily cap `CONCIERGE_USER_CAP_DAILY` (default $0.75). The result passes the same `_validate`; the stored tree is never the model's text.
  - It is mounted for indicator modes when conversation is off, and always on the Conditions tab (`kind: 'scan'`, where a numeric tree is refused).
- **`/converse` (ConverseBox, multi-turn patch authoring).**
  - Gates: `require_paid` plus `require_create_indicator_access`, meaning admin OR the cohort released by `CREATE_INDICATOR_COHORT_ENABLED` + a `user_tags` row.
  - The server returns one structured patch envelope (`uct.authoring.patch/1`) and **never applies or stores it**; the client engine applies and re-validates.
  - The system prompt and tool are constants. All member/view data sits in delimited, JSON-escaped blocks (the prompt-injection boundary).
  - Byte bounds per input, `MAX_OPS` per turn, the shared hourly window, a per-member cap (admin cap separate) and `cost_guard`.
  - Both doors save only through the ordinary `/api/user-definitions` door.
- **Tests.** `tests/test_definition_concierge.py` has **5 failures at production head**. They are mocked, so not cost-related: budget-before-linter ordering ("got budget:nodes"), the repair-attempt count, the refusal shape, and "4 of 1343 firm phrasings anchored NOTHING". The last one references starter screens. Root cause was not investigated (out of scope), but it is reported as test rot on an AI gate.

### 6.3 Library imports

- **Pine libraries** (`pine_library_store.py`, `/api/pine/libraries`, auth required). `import Author/Lib/N` resolves from an owner-curated data store (`$PINE_LIBRARY_DIR` / `$DATA_DIR/pine_libraries`), never stored in git. Versions are exact. Licence and attribution are shown in the Import box (`PineBox.jsx:1114-1119`). This is Pine-only; there is no thinkScript/TC2000 equivalent. `test_pine_library_store.py` passed.
- **Starter library** (`starterScans.json`, `StarterLibrary.jsx`, `starter_library.py`). Firm setups (8 starters) as ordinary native definitions, grounded in `SETUP_GROUPS` and server screener starters. They are **not** third-party imports. **4 failing tests** in `test_starter_library.py`: "Classic Flag/Pullback is no longer grounded: the screener no longer ships a starter screen called 'starter_leaders_pullback'". There is also a static rail that flags the word "starter" in a `user_definitions.py` docstring. The browser reads the static JSON, so the card still renders while its grounding has rotted.
- **Bulk paste intake** (`libraryIntake.js`). It splits on Pine `//@version` only: a pasted folder of thinkScript or PCF is read as one script. For a valid PCF `inspectScript('C > AVGC50')` returns "this does not read as Pine, thinkScript or a TC2000 formula" (`detect.test.js`), which is a false sentence.

---

## 7. Local, unreleased thinkScript work in `C:/w/rpw` (read-only `git diff`)

`C:/w/rpw` is branch head `59e1520106` (`release/m3-stabilization` re-sync). It has an uncommitted **+165-line** change to `app/src/components/chart/engine/ast/thinkscript.js` only. There are no tests in the diff. It is labelled "UIE-1 (2026-10-10)". **Local and unreleased:**
- New note code `thinkscript:note-carried`: "this line sets how the study is drawn, and the chart draws it that way…".
- `TS_COLORS`: 24 `Color.*` constants mapped to hex from the vendor pages. `CreateColor(r,g,b)` is read for literal bytes.
- `TS_PAINTING`: LINE, HISTOGRAM, BOOLEAN_ARROW_UP/DOWN → Pine's presentation shape (`markers`, `arrowUp/belowBar`…). POINTS, ARROW_*, SQUARES and others are deliberately not carried.
- `SetLineWeight` 1–5. `declare lower/upper` → `ctx.overlay` (false/true).
- `readStatement` stores carried presentation per plot in `ctx.presentation`, plus `ctx.carriedNotes` so the note can be downgraded when the target is not a real plot.

**State: incomplete.** The diff collects presentation into `ctx`, but does not touch `translateThinkScript`. Nothing yet emits `presentation` on the report or outputs, and `carriedNotes` is never resolved. If shipped as-is, the new note would say "the chart draws it that way" while the import still drew default lines, which would be a false claim. It also does not yet cover AssignValueColor, AddCloud, SetStyle, constant-plot→level, or the *no-declare = upper* default.

---

## 8. Prioritised compatibility roadmap (what unlocks the most migrations)

Ranked by (share of real thinkorswim/TC2000 scripts affected) × (cost of the current failure).

1. **Fix F1 and F2 first (P0).** These are correctness defects, not coverage gaps; they put wrong numbers under an "exact" label.
   - STOC: change one line (`series: ['high','low','close']`) and re-pin `pcf.vocabulary.test.js` against `stoch(high, low, close, 14)`. Add a numeric rail versus an independent %K, and correct the `_functions_indicators` prose.
   - MTF: either wrap the maximal sub-expression that reads only one aggregation in `tf(…)` (as Pine does), or refuse any `tf` read that is the argument of a windowed function or an offset. Add a numeric weekly-SMA rail and disclose the forming-versus-closed lag.
2. **Study references with thinkorswim's UI defaults.** `RSI()`, `RSI(14)`, `MACD()`/`.Value`/`.Avg`/`.Diff`, `StochasticFull/Slow/Fast`, `BollingerBands()`, `KeltnerChannels`, `ADX`/`DMI`, `ATR()`, `MovAvgExponential(close, 21)`. These defaults are on every member's screen and in their own Edit Studies dialog. The door refuses because the *web page* lacks a Default column. Accept positional args and the dialog defaults, with a disclosed note. Largest single unlock: most Stock Hacker scans and watchlist columns reference RSI/MACD/Stochastic. A one-click conventional call already exists for 4 studies; extending it to auto-apply would also help.
3. **Stock Hacker one-liner detection (F3).** Lower-case thinkScript words (`close`, `volume`, `Average(`, `[n]`) should outrank the PCF AND/OR marker. This is cheap and affects the most common paste.
4. **Presentation carriage** (finish the rpw UIE-1 work and wire it through `translateThinkScript` → `PineBox` → `BuilderSheet`):
   - default upper placement;
   - histogram and arrows;
   - colours and width;
   - constant plots → levels;
   - AssignValueColor at least as "disclosed, drawn flat";
   - AddCloud → fill.
   Visual fidelity is what a migrating trader notices first.
5. **Live inputs for thinkScript** (the Pine `declareInputs`/paramManifest path). Without it every saved import has frozen lengths.
6. **`rec`/`CompoundValue` running state** (ratchets, streak counters, trailing stops). This is common in thinkorswim, and it would need an unbounded or long-warm-up accumulator decision from the owner.
7. **`fold` beyond rolling sum, `GetValue`, `Crosses()` function form, `script{}` subs.** Medium frequency.
8. **PCF fundamentals** (`EPS`, `PE`, sales growth, `Sector/Industry`): the engine has scalars (it suggested `pb`/`peg`), but PCF names are not mapped. Also `BarsSince`, and disclosing the EMA seed for `XAVG`/`MACD`.
9. **Alert() → product alert** and **AddLabel → a value pill**. Lower priority.
10. **Session/time functions.** Keep refused for daily, and revisit with intraday definitions.

---

## 9. Gaps (P0–P3)

### G1 — P0 — PCF `STOC` wrong argument order
- **Evidence:** `pcf.js:196`; `closedTable.json:1264-1279`; `interpret.js:2768`; `api/services/ast_interpret.py:2206`; `pcf.vocabulary.test.js:292-301`; scratch `stoch.test.js`, `stochImpact.test.js`.
- **Current:** `stoch(close, high, low, n)`, range −146…97, labelled Exact import.
- **Expected:** `stoch(high, low, close, n)`, 0–100.
- **User impact:** every TC2000 stochastic scan, sort or alert returns wrong symbols (122/400 bars wrong for `STOC14.3 < 20`), and every saved PCF STOC definition is wrong in both lanes.
- **Complexity:** S (one line plus re-pinning tests).
- **Dependencies:** none. The change alters `astHash` of saved PCF STOC definitions, so they need a migration or re-save plan.
- **Regression risk:** low for maths. Medium for identity: saved definitions get a new hash, and alerts bound to the old hash need handling.

### G2 — P0 — thinkScript MTF composed with functions/offsets computed on base bars
- **Evidence:** `thinkscript.js:3869-3871`; corpus 07; `numeric.test.js` (0/120, 9.6–12.2% error); `debug.test.js`; contrast with the Pine door `tf(sma(close,10),'W')`.
- **Current:** `sma(tf(close,'W'),10)` with "the values are the same".
- **Expected:** a 10-week SMA (`tf(sma(close,10),'W')`) or a refusal, with the forming-versus-closed difference disclosed.
- **User impact:** weekly/monthly MA studies and scans silently wrong.
- **Complexity:** M.
- **Dependencies:** the `tf` evaluator. Owner decision on forming versus closed.
- **Regression risk:** low (it is currently wrong).

### G3 — P1 — thinkScript scan one-liners misdetected as PCF
- **Evidence:** `dialect.js:93-98`; `PineBox.jsx:265-288`; `detect.test.js`.
- **Current:** PCF refusal with wrong advice.
- **Expected:** read as thinkScript.
- **Impact:** high (the most common thinkorswim scan shape).
- **Complexity:** S–M.
- **Dependencies:** the PCF detector rails (`pcf.test.js` corpus-never-PCF).
- **Risk:** medium (detector precedence).

### G4 — P1 — study references with defaults and MACD/Stochastic/Keltner/ADX/VWAP unmapped
- **Evidence:** `TS_DOC_BLOCKED:1534`; `TS_CALL_SHAPES:2497-3035`; corpus 10; probes; `thinkscript.corpus.test.js:387` (10 of 24).
- **Impact:** high.
- **Complexity:** M per study (cite plus default policy).
- **Dependencies:** owner ruling that thinkorswim UI defaults are admissible, with a disclosure note.
- **Risk:** low if each is numerically railed.

### G5 — P1 — thinkScript presentation and placement lost
- **Evidence:** `TS_CHROME_*:1847-1880`; `presentation` absent from the thinkscript report (`PineBox.jsx:388`); `BuilderSheet.jsx:1006`; corpus 01–04, 09.
- **Current:** every plot is drawn as a default line in a lower pane; boolean arrows draw as 0/1 lines; OB/OS levels are dropped.
- **Expected:** placement, styles and levels carried (or disclosed per item).
- **Impact:** high on perceived quality.
- **Complexity:** M (rpw has started).
- **Dependencies:** the Pine presentation shape, already in place.
- **Risk:** low–medium.

### G6 — P1 — thinkScript inputs frozen at save
- **Evidence:** `PineBox.jsx:82-99, 789`; `thinkscript.js` has no `memberInputs`/`inputParams`; `ImportBox.thinkscript.test.jsx:215-258`.
- **Impact:** medium–high.
- **Complexity:** M.
- **Dependencies:** the paramManifest machinery (Pine).
- **Risk:** medium.

### G7 — P2 — `rec`/`CompoundValue` running counters, ratchets and `fold` refused
- **Evidence:** corpus 06, 08, 11; `thinkscript.selfref.test.js`; `thinkscript.fold.test.js`.
- **Impact:** medium.
- **Complexity:** L (accumulator semantics).
- **Dependencies:** an owner ruling on unbounded state.
- **Risk:** high (repaint/window semantics).

### G8 — P2 — false or screen-framed sentences
- **Evidence:** `importOutcome.js` (constant plot = "hidden by the script itself"); `thinkscript.js:273-299` (`note-declare`, `Alert`); `libraryIntake.js` ("does not read as … TC2000"); `editor/languages.js:366` (stale "thinkscript.js does not exist").
- **Impact:** trust.
- **Complexity:** S.
- **Risk:** low (sentence rails exist and need updating).

### G9 — P2 — "Exact import" labels not vendor-verified for PCF smoothing families
- **Evidence:** corpus 09 (21 early-bar seed differences); `importOutcome.js` emits no PCF seed rule (`TREE_SEMANTIC_RULES` is empty).
- **Current:** "Exact" for XAVG/MACD/STDDEV/ATR.
- **Expected:** a disclosed seed note, or a vendor-captured parity check.
- **Complexity:** S (note) / M (capture).
- **Risk:** low.

### G10 — P2 — starter-library grounding rot and AI-gate test rot at production head
- **Evidence:** `tests/test_starter_library.py` 4 failures ("Classic Flag/Pullback … `starter_leaders_pullback`"); `tests/test_definition_concierge.py` 5 failures.
- **Impact:** a starter card attests to a screen that no longer exists, and AI-gate ordering rails are red.
- **Complexity:** S–M.
- **Risk:** low.

### G11 — P3 — bulk intake ignores thinkScript/PCF boundaries
- **Evidence:** `libraryIntake.js` `splitPaste` splits on `//@version` only.
- **Complexity:** S.

### G12 — P3 — `Crosses()` function form gives a misleading syntax refusal
- **Evidence:** corpus 15 ("this thinkScript line does not end where a statement has to end").
- **Complexity:** S.

### G13 — P3 — screenshot rate limit is per process
- **Evidence:** `indicator_vision.py:46-80` (in-memory `_calls`).
- **Impact:** low with one web pod. The global `cost_guard` backstops it.
- **Complexity:** S.

### G14 — P3 — PCF fundamentals other than market cap
- **Evidence:** corpus 14; probes `pe`/`eps` route to the native door with "did you mean `pb`/`peg`".
- **Complexity:** M (unit tables per field).

---

## 10. Tests run (all targeted)

| Command | Result |
|---|---|
| `npx vitest run src/components/chart/engine/ast/thinkscript src/components/chart/engine/ast/pcf …/dialect.test.js …/foreignLanguage.test.js …/doorCoverage.test.js …/doorScorecard.test.js …/thinkscriptIntake.test.js` | 22 files, **754 passed** |
| `npx vitest run src/components/chart/builder/ImportBox …/BuilderSheet.pcf.test.jsx …/ImageBox.test.jsx …/StarterLibrary.test.jsx …/libraryIntake.test.js …/pineBoxImportOutcome.test.jsx …/ConciergeBox.test.jsx …/BuilderSheet.starters.test.jsx …/builder/editor` | 20 files, **274 passed** |
| `pytest tests/test_indicator_from_image.py tests/test_definition_concierge.py tests/test_starter_library.py tests/test_pine_library_store.py` | 164 passed, **9 failed** (concierge ×5, starter ×4 — pre-existing at 84164aee3d; see G10) |
| Scratch (`app/src/__audit_scratch__/ws6/`, not committed): `inventory`, `corpus`, `numeric`, `debug`, `stoch`, `stochImpact`, `detect` | all ran; results quoted above |

The green suites did not catch F1 (the STOC test pins the wrong tree) or F2 (MTF tests check shape only). Both need numeric rails against independent references.
